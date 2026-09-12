/**
 * Public event sanitizer (Milestone 6 server work unit 3; engine spec §13,
 * multiplayer spec §§12-13).
 *
 * `sanitizePublicEvents` turns engine `TurnEvent` / `MatchRulesEvent` batches
 * into fresh, JSON-safe public event objects for the transport layer. The
 * mapping is exhaustive over the known union and fails closed: any future event
 * variant the sanitizer does not know how to project safely throws a typed
 * `PublicEventError` instead of leaking an unsafe shape.
 *
 * Privacy contract:
 * - `CARD_PLAYED`, `CARD_FORCED_FACE_UP`, and `HANDS_REVEALED` carry the card's
 *   public identity (`{ value, type }`) but never its `instanceId`.
 * - No command, guess value, insertion index, swap choice, hidden/detached card
 *   identity, or any undocumented runtime field is ever copied through.
 */
import type {
  CardInstance,
  CardType,
  MatchRulesEvent,
  PlayerId,
  TurnEvent,
} from '@power-hungry-pets/game-engine';

/** A public card as events may carry it: printed value and type only. */
export interface PublicEventCard {
  value: number;
  type: CardType;
}

/** Public, JSON-safe event shapes; every member is a fresh object per call. */
export type PublicEvent =
  | { type: 'CARD_DRAWN'; playerId: PlayerId }
  | { type: 'CARD_PLAYED'; playerId: PlayerId; card: PublicEventCard }
  | { type: 'PECERA_GUESS_RESOLVED'; actorId: PlayerId; targetId: PlayerId; correct: boolean }
  | { type: 'SAQUEADOG_RESOLVED'; playerId: PlayerId }
  | { type: 'RATON_RESOLVED'; playerId: PlayerId }
  | { type: 'PROTECTION_EXPIRED'; playerId: PlayerId }
  | { type: 'HANDS_SWAPPED'; playerIds: [PlayerId, PlayerId] }
  | { type: 'HANDS_REDEALT'; playerIds: PlayerId[] }
  | { type: 'CARD_FORCED_FACE_UP'; playerId: PlayerId; card: PublicEventCard }
  | { type: 'PLAYER_PROTECTED'; playerId: PlayerId }
  | { type: 'PLAYER_ELIMINATED'; playerId: PlayerId }
  | { type: 'HANDS_REVEALED'; hands: Array<{ playerId: PlayerId; card: PublicEventCard }> }
  | { type: 'ROUND_ENDED'; winnerIds: PlayerId[] }
  | { type: 'TOKEN_AWARDED'; playerId: PlayerId }
  | { type: 'MATCH_ENDED'; winnerIds: PlayerId[] };

/** Stable, typed failure codes raised by the sanitizer. */
export const PublicEventErrorCode = {
  /** The event type has no known public projection; the batch is refused. */
  UnknownEventType: 'UNKNOWN_EVENT_TYPE',
  /**
   * A known event type carries a malformed payload (for example a corrupt or
   * missing card identity); the batch is refused instead of throwing a raw
   * TypeError from field access.
   */
  UnknownPublicEvent: 'UNKNOWN_PUBLIC_EVENT',
} as const;

export type PublicEventErrorCode = (typeof PublicEventErrorCode)[keyof typeof PublicEventErrorCode];

/** Typed sanitizer failure. Failing closed means throwing — never projecting. */
export class PublicEventError extends Error {
  readonly code: PublicEventErrorCode;

  constructor(code: PublicEventErrorCode, message: string) {
    super(message);
    this.name = 'PublicEventError';
    this.code = code;
    // Keep `instanceof` reliable when TypeScript downlevels the class.
    Object.setPrototypeOf(this, PublicEventError.prototype);
  }
}

/**
 * Copies a card into its public value/type shape, dropping the instance id.
 * A malformed card payload on a known event type fails closed with a typed
 * `PublicEventError` (`UNKNOWN_PUBLIC_EVENT`) instead of a raw TypeError.
 */
function publicCard(eventType: string, card: unknown): PublicEventCard {
  const candidate = card as Partial<CardInstance> | null | undefined;
  if (
    typeof card !== 'object' ||
    card === null ||
    typeof candidate?.value !== 'number' ||
    !Number.isFinite(candidate.value) ||
    typeof candidate?.type !== 'string'
  ) {
    throw new PublicEventError(
      PublicEventErrorCode.UnknownPublicEvent,
      `Event type "${eventType}" carries a malformed card payload; refusing to sanitize.`,
    );
  }
  return { value: candidate.value, type: candidate.type };
}

/**
 * Sanitizes an ordered batch of engine events into fresh public event objects.
 * Pure: reads the input, returns new plain objects, and never mutates or aliases
 * the input events or their cards. A failure throws before any partial output.
 */
export function sanitizePublicEvents(
  events: ReadonlyArray<TurnEvent | MatchRulesEvent>,
): PublicEvent[] {
  return events.map((event) => sanitizeOne(event));
}

function sanitizeOne(event: TurnEvent | MatchRulesEvent): PublicEvent {
  switch (event.type) {
    case 'CARD_DRAWN':
      return { type: event.type, playerId: event.playerId };
    case 'CARD_PLAYED':
      return {
        type: event.type,
        playerId: event.playerId,
        card: publicCard(event.type, event.card),
      };
    case 'PECERA_GUESS_RESOLVED':
      return {
        type: event.type,
        actorId: event.actorId,
        targetId: event.targetId,
        correct: event.correct,
      };
    case 'SAQUEADOG_RESOLVED':
    case 'RATON_RESOLVED':
    case 'PROTECTION_EXPIRED':
    case 'PLAYER_PROTECTED':
    case 'PLAYER_ELIMINATED':
      return { type: event.type, playerId: event.playerId };
    case 'HANDS_SWAPPED':
      return { type: event.type, playerIds: [event.playerIds[0], event.playerIds[1]] };
    case 'HANDS_REDEALT':
      return { type: event.type, playerIds: [...event.playerIds] };
    case 'CARD_FORCED_FACE_UP':
      return {
        type: event.type,
        playerId: event.playerId,
        card: publicCard(event.type, event.card),
      };
    case 'HANDS_REVEALED':
      return {
        type: event.type,
        hands: event.hands.map((hand) => ({
          playerId: hand.playerId,
          card: publicCard(event.type, hand.card),
        })),
      };
    case 'ROUND_ENDED':
      return { type: event.type, winnerIds: [...event.winnerIds] };
    case 'TOKEN_AWARDED':
      return { type: event.type, playerId: event.playerId };
    case 'MATCH_ENDED':
      return { type: event.type, winnerIds: [...event.winnerIds] };
    default:
      return failUnknown(event);
  }
}

/** Fail-closed guard: an unknown variant can never be projected. */
function failUnknown(event: never): never {
  const type = String((event as { type?: unknown }).type);
  throw new PublicEventError(
    PublicEventErrorCode.UnknownEventType,
    `Event type "${type}" has no known public projection; refusing to sanitize.`,
  );
}
