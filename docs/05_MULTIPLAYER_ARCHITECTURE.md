# Multiplayer Architecture

Implemented in Milestone 6. This document is the authoritative description of the shipped multiplayer contract: NestJS + Socket.IO server, in-memory authoritative state, one game engine, typed acknowledgements, and strict public/private information isolation.

## 0. Implemented contract at a glance

| Area | Decision |
|---|---|
| Server | NestJS WebSocket gateway (`apps/server/src/gateway/game.gateway.ts`) delegating to `GameSessionService` and the framework-independent engine. Handlers never hold rule logic. |
| Rooms | In-memory registry (`apps/server/src/room/`): guarded `CREATED → LOBBY → IN_MATCH → FINISHED → EXPIRED` lifecycle, 2–6 seats (hard cap 6), host privileges, socket bindings. |
| Room codes | 5 characters over a 32-symbol unambiguous Crockford base32 alphabet (`0-9`, `A-Z` minus `I L O U`); crypto-random, collision-checked with bounded retries. Matchmaking handles, not credentials. |
| Identity | One crypto-random stable `playerId` per seat, independent of socket ids. Membership is authorized by socket binding, never by payload-supplied identity. |
| Reconnect tokens | 32 random bytes, base64url-encoded; handed to the client exactly once; the registry retains **only the SHA-256 hash**, compared in **constant time** (`timingSafeEqual`). Snapshots never contain token material. |
| Commands | One event, `game:command`, carrying the exact engine `TurnCommand`; shape-validated at the gateway boundary (fresh object, client payload never passed through), semantically validated by the session/engine. |
| Acks | Every request answers a typed envelope `{ ok: true, data }` / `{ ok: false, error: { code, message, engineCode? } }`. Malformed payloads fail with `INVALID_PAYLOAD`, never a raw TypeError. |
| Events | Server→client: `room:updated`, `game:event` (sanitized public events), `game:public-state`, `game:private-state` (per-seat), `match:ended`. Runtime payload guards sanitize everything and fail closed. |
| Session | One session per room code; transactional `handleCommand` (actor check → engine → invariants → sanitize → single commit), per-session engine RNG stream, auto next-round setup. |
| RNG | One per-session engine RNG stream derived from a 32-bit crypto seed; Card 7's re-deal is always safe; a session replays deterministically from its seed (rollback rewinds the stream). |
| Disconnect | Marks `connected: false` only. The seat, its token, and host status are retained; no auto-play, no skip, no elimination. Explicit leave is rejected during `IN_MATCH`. |
| Join limiter | Per-socket connection: 8 `room:join` attempts / 60 s sliding window, counted before payload validation; other gameplay events are never limited. The per-socket counter is forgotten on disconnect. Per-address/proxy hardening is deferred. |
| Memory only | All state lives in process memory. No TTL/expiry, persistence, rematch, or spectators. Explicitly deferred to later milestones (§19). |

## 1. Principle

The multiplayer implementation is **server authoritative**.

Clients send intentions.

The server validates and executes rules.

Clients never decide:

- deck order;
- draw results;
- card ownership;
- whether a target is legal;
- whether a guess is correct;
- whether a player is eliminated;
- round winner;
- match winner.

## 2. Implemented architecture

```text
Browser / Next.js (Milestone 7, deferred)
       │
       │ Socket.IO (typed AckEnvelope contract, docs §8)
       ▼
NestJS Game Gateway            apps/server/src/gateway/game.gateway.ts
       │   shape-only payload guards, socket-authenticated membership,
       │   join rate limiting, sanitized fanout
       ▼
Game Session Service           apps/server/src/session/game-session.service.ts
       │   one session per room code, transactional handleCommand,
       │   per-session engine RNG, invariant assertions, auto-round
       ├──▶ Room Registry          apps/server/src/room/ (lifecycle, codes, tokens, bindings)
       ├──▶ Event Sanitizer        apps/server/src/projection/public-events.ts (fail closed)
       ▼
Framework-independent Game Engine    packages/game-engine (pure, no I/O)
```

Persistence and Redis are optional infrastructure around this flow, not game-rule authorities — and none of it exists yet (§16, §19).

## 3. Room lifecycle (implemented)

Statuses are guarded forward transitions only; `EXPIRED` is terminal (nothing may follow it):

```text
CREATED → LOBBY → IN_MATCH → FINISHED → EXPIRED
   │          │          │           │
   └──────────┴──────────┴───────────┴──→ EXPIRED (terminal, not yet emitted by any flow)
```

Only the current host may drive a transition; illegal transitions throw a typed `INVALID_ROOM_TRANSITION`. Entering `IN_MATCH` additionally requires at least 2 seats. The creator is seat 1 and host; the gateway moves a fresh room straight into `LOBBY` so `room:start` begins from a LOBBY room. When a match's final command ends the match, the registry transitions the room to `FINISHED` (host identity is server-internal, never taken from the client payload) and one `match:ended` broadcast fires.

Joining is accepted only in `CREATED` and `LOBBY`; `IN_MATCH`, `FINISHED`, and `EXPIRED` rooms reject new seats with `INVALID_ROOM_TRANSITION`.

### Explicit leave, disconnect, and host transfer

- **Disconnect** (transport drop, any status): the seat's `connected` overlay flips to false and the room/public/private fanout updates; seat, reconnect token, and host status are retained. Disconnect is the supported pause path during a match.
- **Explicit leave** (`room:leave`): authenticated by the socket currently bound to a seat in the target room — never by a caller-supplied `playerId`, so one player cannot evict another. **Rejected during `IN_MATCH`** (`INVALID_ROOM_TRANSITION`, no mutation); allowed in `CREATED`, `LOBBY`, and `FINISHED`. When the last seat leaves, the room is deleted and its session is dropped.
- **Host transfer**: if the leaving seat is the host, host privileges transfer to the earliest-joined **connected** remaining seat, falling back to the earliest remaining seat when none are connected.
- **FINISHED cleanup**: leaves after the match ends are allowed; when the final seat leaves, the room and its game session are cleaned up (nothing is left to join).

## 4. Joining (implemented)

Join input:

- `code` (required);
- `displayName` (required for a brand-new seat; normalized by trimming and collapsing internal whitespace, 1–24 characters, else `INVALID_DISPLAY_NAME`);
- `reconnectToken` (present only when rebinding a disconnected seat; must be a nonempty string or the gateway rejects with `INVALID_PAYLOAD` — it never falls through to silently creating a seat).

A successful create/join acks `{ roomId, code, playerId, seatNumber, reconnectToken, room }`; on a token rebind `reconnectToken` is `null` (no new token is issued). A socket may bind to at most one seat anywhere (`DUPLICATE_SOCKET` otherwise). A new seat cannot join a room whose status is not joinable, and a full room rejects the join with `ROOM_FULL` (hard cap 6 seats).

Do not use display name as authentication.

## 5. Player session identity (implemented)

When a player joins, the server issues a random private reconnect token: **32 bytes of crypto randomness, base64url-encoded**.

The token identifies the player's seat for that room and is handed to that client exactly once. The registry retains **only its SHA-256 hash**; raw tokens never live inside the registry, and room snapshots never contain token material (verified by tests). Reconnect verification hashes the presented token and compares hashes in **constant time** (`timingSafeEqual`), so token comparison leaks no timing information.

Store it securely client-side for the session.

Do not expose another player's token.

## 6. Reconnection (implemented)

On socket disconnect:

- keep the player's seat;
- mark them disconnected (transport overlay only — the engine roster is never mutated);
- do not immediately eliminate them;
- do not auto-play, skip, or otherwise advance their turn (see §7).

On valid reconnect (`room:join` with `code` + `reconnectToken`):

- bind the new socket to the same seat (same `playerId` and seat number; no new token — the ack carries `reconnectToken: null`);
- send the fresh room snapshot (`room:updated`), a fresh public state projection (`game:public-state`), and that player's private projection (`game:private-state`);
- restore any pending decision privately: a pending interaction owned by the rejoining actor reappears in their `privateView.pendingDecision` (for example the Saqueadog hidden card), while everyone else only ever sees the public pending type/actor.

A wrong token, a foreign room's token, a still-connected seat (replay), or an already-bound socket is rejected with a typed code (`INVALID_RECONNECT_TOKEN` / `DUPLICATE_SOCKET`) and never creates or mutates a seat.

## 7. Disconnect timeout policy

For MVP, no grace timer exists yet: a disconnected seat is preserved indefinitely (in-memory process lifetime) with its token, and the match simply waits.

After a future grace period, the room may:

- pause and let the host cancel;
- or apply a future forfeit rule.

Do **not** silently invent automatic card plays in the first release: on disconnect there is no auto-play, no turn skip, and no elimination. The disconnected player's turn simply remains; the engine waits for their legal action or pending decision, and a reconnect token can rebind the seat at any time.

Exact timeout UX can be tuned later without changing game rules.

## 8. Socket events (implemented names)

Client → server (exact names, all answering an `AckEnvelope`):

```text
system:ping
room:create   { displayName }
room:join     { code, displayName?, reconnectToken? }
room:leave    { code }
room:start    { code }
game:command  { code, command: TurnCommand }
```

`game:command` carries the **exact engine `TurnCommand`** — `DRAW_CARD`, `PLAY_CARD`, `CHOOSE_TARGET`, `SUBMIT_GUESS`, `CHOOSE_HIDDEN_SWAP`, `CHOOSE_DECK_POSITION` — shape-validated at the gateway boundary (field types only, fresh object, never semantics, never pass-through) and semantically validated by the session. There are no per-action event names.

Server → client (exact names):

```text
room:updated          { room }
game:event            { roomCode, events: PublicEvent[] }
game:public-state     { roomCode, publicView }
game:private-state    { roomCode, playerId, privateView }   // per-socket, one seat only
match:ended           { roomCode, winners, room }
```

(`system:notice` is declared in the contracts but no flow emits it yet.) Every public-facing payload passes runtime guards: unknown event variants and malformed card payloads throw typed errors (`UNKNOWN_EVENT_TYPE` / `UNKNOWN_PUBLIC_EVENT`) instead of leaking unsafe shapes, and undocumented runtime fields are stripped.

## 9. State delivery (implemented)

Prefer sending:

- incremental domain events for animation;
- authoritative snapshots/projections for recovery.

The UI must be able to recover from a missed animation by rendering the latest authoritative state.

The gateway delivers both, in this order after every successful command: the sanitized public event batch (`game:event`), one fresh `game:public-state` to the room channel, and one fresh `game:private-state` per connected seat. Join/reconnect/leave/disconnect/start fan out `room:updated` and — when a live session exists — the same public/private pair. Sanitized events are always computed **before** any state commit, so a sanitizer failure can never leave a half-applied transaction behind.

## 10. Hidden-information isolation (implemented)

The canonical game state must remain server-side. The session composes each projection from deep copies of the match and live round, with the room snapshot's transport connectivity overlaid by player id (projecting never mutates authoritative state):

```ts
const publicView = getPublicGameView(snapshot);               // shared, identical for everyone
const privateView = getPlayerPrivateView(snapshot, playerId); // per seat, fails closed
```

After every successful command and every join/reconnect/leave/disconnect/start, the server broadcasts one fresh `game:public-state` to the room channel and, individually, one `game:private-state` per **connected** seat. A disconnected seat receives nothing until it reconnects.

Never broadcast:

```ts
io.to(room).emit("game:state", canonicalGameState); // never happens
```

Public views carry counts, never identities: draw-pile count, `hiddenCardCount` (0/1), and per-player `handCount`; public discards and revealed hands are `{ value, type }` pairs — never a `CardInstance` or `instanceId`. Engine spec §14 enumerates the full allowed/forbidden field sets.

## 11. Ratón Trampero privacy (implemented)

Only the acting player receives:

- inspected card identity (as a deep copy inside their `pendingDecision.card`);
- insertion controls (their `CHOOSE_DECK_POSITION` legal actions).

Other players receive only a generic event such as:

```text
Player X is resolving Ratón Trampero.
```

Concretely: the public pending interaction shows only `{ type: 'RATON_INSERT_POSITION', actorId }` — never the detached card — and public events never carry the chosen insertion index.

They must not receive the inspected card or chosen insertion index.

## 12. Saqueadog privacy (implemented)

Only the acting player receives the hidden card identity (as a deep copy inside their `pendingDecision.hiddenCard` while `SAQUEADOG_SWAP` is open).

Other players may know that the action is being resolved (public pending `{ type: 'SAQUEADOG_SWAP', actorId }`), but not:

- what the hidden card is;
- whether an exchange occurred. The public `SAQUEADOG_RESOLVED` event carries only the acting player id — the default holds: do not reveal whether the player swapped.

## 13. Hand swaps (implemented)

When two hands are exchanged (Cards 8/9):

- server swaps card instances;
- each affected client receives its new private hand through the next per-seat `game:private-state` fanout;
- other clients receive only a public `HANDS_SWAPPED` event carrying the two player ids — no card identities.

## 14. Anti-cheat baseline (implemented)

- all commands validated server-side: shape at the gateway boundary, semantics in the session (actor spoofing is rejected — `ACTOR_NOT_AUTHENTICATED` — before the engine ever sees the command);
- no canonical hidden state sent to clients; public payloads are runtime-guarded and fail closed (`UNKNOWN_EVENT_TYPE` / `UNKNOWN_PUBLIC_EVENT`);
- reconnect tokens are 32 bytes of crypto randomness, retained only as SHA-256 hashes and verified in constant time;
- room codes are not security credentials;
- `room:join` is rate-limited per socket connection: 8 attempts / 60 s sliding window, counted before payload validation (malformed and invalid joins count too), with a typed `RATE_LIMITED` ack carrying a retry horizon. Already-bound gameplay is never limited. Per-address/proxy-aware limiting is deferred to later milestones;
- display names are sanitized (trim + whitespace collapse, 1–24 chars, else `INVALID_DISPLAY_NAME`);
- stale decisions cannot advance state: a pending interaction resolves exactly once through the engine, and out-of-turn/spoofed/replayed commands are rejected without mutating state.

## 15. Host privileges (implemented)

Host may:

- start the match (`room:start`, host-only — others get `NOT_HOST`) when the roster holds 2–6 seats;
- drive the guarded room lifecycle transitions.

Host may not:

- choose deck order;
- inspect private cards;
- override rules;
- force winners.

The host identity in terminal transitions (e.g. `FINISHED` after match end) is resolved server-side from the registry, never from a client payload. On a host's explicit leave, host privileges transfer to the earliest-joined connected remaining seat (earliest remaining as fallback) — see §3.

## 16. Scaling (implemented as in-memory)

The initial release **holds all active room and session state in process memory** (current reality, not just an option):

- one `RoomRegistry` and one `GameSessionService`, process-wide singletons (`app.module.ts`);
- no TTL, no room expiry, no token expiry — rooms live for the process lifetime unless explicitly deleted by the last seat leaving;
- no persistence or cross-process recovery: a server restart loses all rooms, sessions, and tokens;
- before horizontal scaling, introduce a room-state strategy such as Redis-compatible session storage, sticky sessions, or a dedicated stateful game service.

Do not introduce distributed complexity before it is needed.

## 17. Database

PostgreSQL/Neon is not required to prove multiplayer gameplay and is not used.

Introduce persistence when implementing features such as:

- match history;
- user accounts;
- analytics;
- durable room recovery;
- moderation.

## 18. Deployment caution

If deploying Socket.IO, select hosting that supports persistent WebSocket connections appropriately.

Do not assume a stateless serverless function model can hold authoritative room memory between requests.

## 19. Explicitly deferred to later milestones

None of the following exist in Milestone 6; each is a deliberate deferral, not an omission (see docs/09_OPEN_QUESTIONS.md and the implementation plan):

| Deferred area | Later milestone | Current state |
|---|---|---|
| Room TTL / expiry / token expiry | 9 | Rooms and tokens live for process lifetime; last-seat leave is the only deletion path; `EXPIRED` status exists but no flow emits it. |
| Per-IP / proxy-aware rate limiting | 9 | Join limiting is per socket connection only (8/60s); trusted-address keying belongs at the transport/proxy layer. |
| Persistence (Redis/Postgres), durable recovery | 9 | Everything is in-memory; restart loses all state. |
| Rematch | after 7 | `FINISHED` is terminal short of `EXPIRED`; no rematch flow exists. |
| Spectators | after 7 | Every seat is a player; no observer role exists. |
| Frontend (Next.js client) | 7 | The contract above is exercised only by real Socket.IO test clients. |
