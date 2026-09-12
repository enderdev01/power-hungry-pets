import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { RoomError, RoomErrorCode } from './room.errors';
import {
  MAX_DISPLAY_NAME_LENGTH,
  MAX_SEATS_PER_ROOM,
  MIN_SEATS_TO_START_MATCH,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  RoomStatus,
  type CreateRoomInput,
  type DisconnectSeatInput,
  type JoinRoomInput,
  type LeaveRoomInput,
  type ReconnectResult,
  type ReconnectSeatInput,
  type RoomMembership,
  type RoomPlayerView,
  type RoomRegistryOptions,
  type RoomSnapshot,
  type SocketBindingView,
  type TransitionRoomInput,
} from './room.types';

/** Guarded forward lifecycle transitions; EXPIRED is terminal. */
const ALLOWED_TRANSITIONS: Readonly<Record<RoomStatus, readonly RoomStatus[]>> = {
  [RoomStatus.Created]: [RoomStatus.Lobby, RoomStatus.Expired],
  [RoomStatus.Lobby]: [RoomStatus.InMatch, RoomStatus.Expired],
  [RoomStatus.InMatch]: [RoomStatus.Finished, RoomStatus.Expired],
  [RoomStatus.Finished]: [RoomStatus.Expired],
  [RoomStatus.Expired]: [],
};

/** Pre-match statuses that accept new seats. */
const JOINABLE_STATUSES: ReadonlySet<RoomStatus> = new Set([RoomStatus.Created, RoomStatus.Lobby]);

/** Collision retries before code generation is declared exhausted. */
const MAX_CODE_GENERATION_ATTEMPTS = 8;

/** Generated codes must be exactly ROOM_CODE_LENGTH symbols of the alphabet. */
const ROOM_CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

/**
 * Internal seat record. Only the SHA-256 hash of the reconnect token is
 * retained here; the raw token never lives inside the registry.
 */
interface RoomSeat {
  playerId: string;
  displayName: string;
  seatNumber: number;
  joinedAt: number;
  /** SHA-256 hex digest of the reconnect token. */
  tokenHash: string;
}

interface RoomRecord {
  roomId: string;
  code: string;
  status: RoomStatus;
  hostPlayerId: string;
  createdAt: number;
  seats: RoomSeat[];
  /** Monotonic join counter; drives seat numbers and earliest-joined ordering. */
  joinSeq: number;
}

interface SocketBinding {
  code: string;
  playerId: string;
}

/** Normalizes user-supplied display names: trim + collapse internal whitespace. */
function normalizeDisplayName(raw: string): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0 || collapsed.length > MAX_DISPLAY_NAME_LENGTH) {
    throw new RoomError(
      RoomErrorCode.InvalidDisplayName,
      `display name must be 1-${MAX_DISPLAY_NAME_LENGTH} characters after normalization`,
    );
  }
  return collapsed;
}

/** Normalizes a room code for lookup: trim + uppercase. */
function normalizeRoomCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/** SHA-256 hex digest used as the only retained form of a reconnect token. */
function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

interface IssuedSeat {
  seat: RoomSeat;
  /** Raw reconnect token, handed back exactly once to the joining client. */
  reconnectToken: string;
}

/**
 * Pure in-memory room registry: room creation, joining by code, reconnectable
 * seat lifecycle, and guarded status transitions. Every returned snapshot is
 * a deep copy, so callers cannot mutate registry internals.
 */
export class RoomRegistry {
  private readonly rooms = new Map<string, RoomRecord>();
  /** socketId -> binding; a socket may be bound to at most one seat anywhere. */
  private readonly sockets = new Map<string, SocketBinding>();
  private readonly generateRoomCode: () => string;
  private readonly generateReconnectToken: () => string;

  constructor(options: RoomRegistryOptions = {}) {
    this.generateRoomCode = options.generateRoomCode ?? RoomRegistry.defaultGenerateRoomCode;
    this.generateReconnectToken =
      options.generateReconnectToken ?? RoomRegistry.defaultGenerateReconnectToken;
  }

  /** Default code: 5 unambiguous uppercase symbols, crypto-random. */
  private static defaultGenerateRoomCode(): string {
    const bytes = randomBytes(ROOM_CODE_LENGTH);
    let code = '';
    for (const byte of bytes) {
      code += ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length];
    }
    return code;
  }

  /** Normalizes (trim + uppercase) and validates a generated code before acceptance. */
  private normalizeGeneratedRoomCode(raw: string): string {
    const code = raw.trim().toUpperCase();
    if (!ROOM_CODE_PATTERN.test(code)) {
      throw new RoomError(
        RoomErrorCode.RoomCodeGenerationFailed,
        `generated room code is not ${ROOM_CODE_LENGTH} symbols of the configured alphabet`,
      );
    }
    return code;
  }

  /** Default reconnect token: 32 random bytes, base64url-encoded. */
  private static defaultGenerateReconnectToken(): string {
    return randomBytes(32).toString('base64url');
  }

  /**
   * Creates a room whose creator becomes seat 1 and host, already connected.
   * Room codes are collision-checked against live rooms with bounded retries.
   */
  createRoom(input: CreateRoomInput): RoomMembership {
    const displayName = normalizeDisplayName(input.displayName);
    this.assertSocketFree(input.socketId);

    let code: string | undefined;
    for (let attempt = 0; attempt < MAX_CODE_GENERATION_ATTEMPTS; attempt += 1) {
      const candidate = this.normalizeGeneratedRoomCode(this.generateRoomCode());
      if (!this.rooms.has(candidate)) {
        code = candidate;
        break;
      }
    }
    if (code === undefined) {
      throw new RoomError(
        RoomErrorCode.RoomCodeGenerationFailed,
        `could not generate a unique room code after ${MAX_CODE_GENERATION_ATTEMPTS} attempts`,
      );
    }

    const issued = this.issueSeat(displayName);
    const room: RoomRecord = {
      roomId: randomUUID(),
      code,
      status: RoomStatus.Created,
      hostPlayerId: issued.seat.playerId,
      createdAt: Date.now(),
      seats: [issued.seat],
      joinSeq: 1,
    };
    issued.seat.seatNumber = room.joinSeq;
    this.rooms.set(code, room);
    this.bindSocket(input.socketId, code, issued.seat.playerId);

    return {
      roomId: room.roomId,
      code: room.code,
      playerId: issued.seat.playerId,
      seatNumber: issued.seat.seatNumber,
      reconnectToken: issued.reconnectToken,
    };
  }

  /** Joins an existing room by code as a new connected seat. */
  joinRoom(input: JoinRoomInput): RoomMembership {
    const code = normalizeRoomCode(input.code);
    const room = this.requireRoom(code);

    if (!JOINABLE_STATUSES.has(room.status)) {
      throw new RoomError(
        RoomErrorCode.InvalidRoomTransition,
        `room ${code} is not joinable in status ${room.status}`,
      );
    }

    const displayName = normalizeDisplayName(input.displayName);
    this.assertSocketFree(input.socketId);

    if (room.seats.length >= MAX_SEATS_PER_ROOM) {
      throw new RoomError(
        RoomErrorCode.RoomFull,
        `room ${code} already has ${MAX_SEATS_PER_ROOM} seats`,
      );
    }

    room.joinSeq += 1;
    const issued = this.issueSeat(displayName);
    issued.seat.seatNumber = room.joinSeq;
    room.seats.push(issued.seat);
    this.bindSocket(input.socketId, code, issued.seat.playerId);

    return {
      roomId: room.roomId,
      code: room.code,
      playerId: issued.seat.playerId,
      seatNumber: issued.seat.seatNumber,
      reconnectToken: issued.reconnectToken,
    };
  }

  /**
   * Rebinds a disconnected seat to a new socket using its reconnect token.
   * Never creates a player: the seat and its stable playerId survive.
   * Token comparison is constant-time against retained SHA-256 hashes.
   */
  reconnectSeat(input: ReconnectSeatInput): ReconnectResult {
    const code = normalizeRoomCode(input.code);
    const room = this.requireRoom(code);
    this.assertSocketFree(input.socketId);

    const providedHash = Buffer.from(sha256Hex(input.reconnectToken), 'hex');
    const seat = room.seats.find((candidate) =>
      timingSafeEqual(Buffer.from(candidate.tokenHash, 'hex'), providedHash),
    );
    if (seat === undefined) {
      throw new RoomError(
        RoomErrorCode.InvalidReconnectToken,
        'reconnect token does not match any seat in this room',
      );
    }
    if (this.isConnected(code, seat.playerId)) {
      throw new RoomError(
        RoomErrorCode.DuplicateSocket,
        'seat is still connected; reconnect replay rejected',
      );
    }

    this.bindSocket(input.socketId, code, seat.playerId);
    return {
      roomId: room.roomId,
      code: room.code,
      playerId: seat.playerId,
      seatNumber: seat.seatNumber,
    };
  }

  /**
   * Marks the seat bound to `socketId` as disconnected: transport overlay off,
   * seat and (if applicable) host retention intact. Socket binding is cleared.
   */
  disconnectSeat(input: DisconnectSeatInput): RoomSnapshot {
    const code = normalizeRoomCode(input.code);
    const room = this.requireRoom(code);

    const binding = this.sockets.get(input.socketId);
    const seat =
      binding !== undefined && binding.code === code
        ? room.seats.find((candidate) => candidate.playerId === binding.playerId)
        : undefined;
    if (seat === undefined) {
      throw new RoomError(
        RoomErrorCode.PlayerNotFound,
        `no seat in room ${code} is bound to socket ${input.socketId}`,
      );
    }

    this.sockets.delete(input.socketId);
    return this.snapshotOf(room);
  }

  /**
   * Explicitly removes the seat currently bound to `socketId` in the
   * target room. The leave is authenticated by the room-bound socket —
   * never by a caller-supplied public playerId — so one player cannot
   * evict another. If the leaving seat is the host, host privileges
   * transfer to the earliest-joined connected remaining seat (falling
   * back to the earliest remaining seat when none are connected). When
   * the last seat leaves, the room is deleted.
   */
  leaveRoom(input: LeaveRoomInput): RoomSnapshot | null {
    const code = normalizeRoomCode(input.code);
    const room = this.requireRoom(code);

    // Explicit leave is rejected while a match is running: disconnect is the
    // supported pause/reconnect behavior mid-match (seat, token, and host are
    // preserved by disconnect). FINISHED, LOBBY, and CREATED leaves remain
    // allowed. The guard runs at this registry authority before any mutation
    // or binding change.
    if (room.status === RoomStatus.InMatch) {
      throw new RoomError(
        RoomErrorCode.InvalidRoomTransition,
        `room ${code} is IN_MATCH: disconnect to pause instead of leaving explicitly`,
      );
    }

    const binding = this.sockets.get(input.socketId);
    if (binding === undefined || binding.code !== code) {
      throw new RoomError(
        RoomErrorCode.SocketNotBound,
        `socket ${input.socketId} is not bound to a seat in room ${code}`,
      );
    }

    const seatIndex = room.seats.findIndex((candidate) => candidate.playerId === binding.playerId);
    if (seatIndex === -1) {
      throw new RoomError(
        RoomErrorCode.PlayerNotFound,
        `socket ${input.socketId} points to a missing seat in room ${code}`,
      );
    }

    const [removedSeat] = room.seats.splice(seatIndex, 1);
    for (const [socketId, other] of [...this.sockets]) {
      if (other.code === code && other.playerId === removedSeat!.playerId) {
        this.sockets.delete(socketId);
      }
    }

    if (room.seats.length === 0) {
      this.rooms.delete(code);
      return null;
    }

    if (room.hostPlayerId === removedSeat!.playerId) {
      const successor =
        room.seats.find((candidate) => this.isConnected(code, candidate.playerId)) ??
        room.seats[0]!;
      room.hostPlayerId = successor.playerId;
    }

    return this.snapshotOf(room);
  }

  /**
   * Host-guarded status transition. Only the current host may drive the room
   * and only along the guarded forward lifecycle.
   */
  transitionRoom(input: TransitionRoomInput): RoomSnapshot {
    const code = normalizeRoomCode(input.code);
    const room = this.requireRoom(code);

    const caller = room.seats.find((candidate) => candidate.playerId === input.playerId);
    if (caller === undefined) {
      throw new RoomError(
        RoomErrorCode.PlayerNotFound,
        `player ${input.playerId} has no seat in room ${code}`,
      );
    }
    if (room.hostPlayerId !== input.playerId) {
      throw new RoomError(RoomErrorCode.NotHost, 'only the room host may transition the room');
    }

    const allowed = ALLOWED_TRANSITIONS[room.status];
    if (!allowed.includes(input.nextStatus)) {
      throw new RoomError(
        RoomErrorCode.InvalidRoomTransition,
        `cannot transition room from ${room.status} to ${input.nextStatus}`,
      );
    }

    if (input.nextStatus === RoomStatus.InMatch && room.seats.length < MIN_SEATS_TO_START_MATCH) {
      throw new RoomError(
        RoomErrorCode.InvalidRoomTransition,
        `a match needs at least ${MIN_SEATS_TO_START_MATCH} seats (room ${code} has ${room.seats.length})`,
      );
    }

    room.status = input.nextStatus;
    return this.snapshotOf(room);
  }

  /** Snapshot copy for a live room, or `undefined` when unknown. */
  getRoom(code: string): RoomSnapshot | undefined {
    const room = this.rooms.get(normalizeRoomCode(code));
    return room === undefined ? undefined : this.snapshotOf(room);
  }

  /** Snapshot copies of all live rooms, in creation order. */
  listRooms(): RoomSnapshot[] {
    return [...this.rooms.values()].map((room) => this.snapshotOf(room));
  }

  /** Whether `playerId` is the current host of the room (false if unknown). */
  isHost(code: string, playerId: string): boolean {
    const room = this.rooms.get(normalizeRoomCode(code));
    return room !== undefined && room.hostPlayerId === playerId;
  }

  /**
   * Safe lookup of the seat a socket is currently bound to, for server-internal
   * fanout and socket-authenticated operations. Returns `undefined` when the
   * socket has no binding. Never exposes token material.
   */
  getSocketBinding(socketId: string): SocketBindingView | undefined {
    const binding = this.sockets.get(socketId);
    return binding === undefined
      ? undefined
      : { socketId, code: binding.code, playerId: binding.playerId };
  }

  /**
   * Safe list of the socket bindings currently connected to one room, in no
   * guaranteed order, for server-internal private-state fanout. Sockets without
   * a live binding are never included; token hashes are never exposed.
   */
  listConnectedBindings(code: string): SocketBindingView[] {
    const normalized = normalizeRoomCode(code);
    const views: SocketBindingView[] = [];
    for (const [socketId, binding] of this.sockets) {
      if (binding.code === normalized) {
        views.push({ socketId, code: normalized, playerId: binding.playerId });
      }
    }
    return views;
  }

  // -- internals -------------------------------------------------------------

  private issueSeat(displayName: string): IssuedSeat {
    const reconnectToken = this.generateReconnectToken();
    return {
      seat: {
        playerId: randomUUID(),
        displayName,
        seatNumber: 0,
        joinedAt: Date.now(),
        tokenHash: sha256Hex(reconnectToken),
      },
      reconnectToken,
    };
  }

  private requireRoom(code: string): RoomRecord {
    const room = this.rooms.get(code);
    if (room === undefined) {
      throw new RoomError(RoomErrorCode.RoomNotFound, `no live room with code ${code}`);
    }
    return room;
  }

  private assertSocketFree(socketId: string): void {
    if (this.sockets.has(socketId)) {
      throw new RoomError(
        RoomErrorCode.DuplicateSocket,
        `socket ${socketId} is already bound to a seat`,
      );
    }
  }

  private bindSocket(socketId: string, code: string, playerId: string): void {
    this.sockets.set(socketId, { code, playerId });
  }

  private isConnected(code: string, playerId: string): boolean {
    for (const binding of this.sockets.values()) {
      if (binding.code === code && binding.playerId === playerId) {
        return true;
      }
    }
    return false;
  }

  private snapshotOf(room: RoomRecord): RoomSnapshot {
    const players: RoomPlayerView[] = room.seats
      .slice()
      .sort((a, b) => a.seatNumber - b.seatNumber)
      .map((seat) => ({
        playerId: seat.playerId,
        displayName: seat.displayName,
        seatNumber: seat.seatNumber,
        connected: this.isConnected(room.code, seat.playerId),
        isHost: seat.playerId === room.hostPlayerId,
        joinedAt: seat.joinedAt,
      }));

    return {
      roomId: room.roomId,
      code: room.code,
      status: room.status,
      hostPlayerId: room.hostPlayerId,
      createdAt: room.createdAt,
      players,
    };
  }
}
