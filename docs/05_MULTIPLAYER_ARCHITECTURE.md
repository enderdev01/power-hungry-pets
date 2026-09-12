# Multiplayer Architecture

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

## 2. Proposed architecture

```text
Browser / Next.js
       │
       │ Socket.IO
       ▼
NestJS Game Gateway
       │
       ▼
Game Session Service
       │
       ▼
Framework-independent Game Engine
```

Persistence and Redis are optional infrastructure around this flow, not game-rule authorities.

## 3. Room lifecycle

Suggested room states:

```text
CREATED
  ↓
LOBBY
  ↓
IN_MATCH
  ↓
FINISHED
  ↓
EXPIRED
```

## 4. Joining

MVP join input:

- room code;
- display name;
- reconnect token if reconnecting.

Do not use display name as authentication.

## 5. Player session identity

When a player joins, issue a random private reconnect token.

The token identifies the player's seat for that room.

Store it securely client-side for the session.

Do not expose another player's token.

## 6. Reconnection

On socket disconnect:

- keep the player's seat;
- mark them disconnected;
- do not immediately eliminate them.

On valid reconnect:

- bind new socket to the same seat;
- send a fresh public state projection;
- send that player's private projection;
- restore any pending decision.

## 7. Disconnect timeout policy

For MVP, use a configurable grace period.

After the grace period, the room may:

- pause and let the host cancel;
- or apply a future forfeit rule.

Do **not** silently invent automatic card plays in the first release.

Exact timeout UX can be tuned later without changing game rules.

## 8. Socket event categories

Client → server examples:

```text
room:create
room:join
room:leave
room:start

game:draw
game:play-card
game:choose-target
game:submit-guess
game:choose-deck-position
game:choose-hidden-swap

match:rematch
```

Server → client examples:

```text
room:state
game:public-state
game:private-state
game:event
game:error
match:ended
```

Exact names may differ.

## 9. State delivery

Prefer sending:

- incremental domain events for animation;
- authoritative snapshots/projections for recovery.

The UI must be able to recover from a missed animation by rendering the latest authoritative state.

## 10. Hidden-information isolation

The canonical game state must remain server-side.

For every connected player:

```ts
const publicView = getPublicGameView(state);
const privateView = getPlayerPrivateView(state, playerId);
```

Never broadcast:

```ts
io.to(room).emit("game:state", canonicalGameState);
```

## 11. Ratón Trampero privacy

Only the acting player receives:

- inspected card identity;
- insertion controls.

Other players receive only a generic event such as:

```text
Player X is resolving Ratón Trampero.
```

They must not receive the inspected card or chosen insertion index.

## 12. Saqueadog privacy

Only the acting player receives the hidden card identity.

Other players may know that the action is being resolved, but not:

- what the hidden card is;
- whether an exchange occurred, unless the final game rules/UI deliberately reveal only that a decision completed.

Default: do not reveal whether the player swapped.

## 13. Hand swaps

When two hands are exchanged:

- server swaps card instances;
- each affected client receives its new private hand;
- other clients receive only a public "hands exchanged" event.

## 14. Anti-cheat baseline

At minimum:

- all commands validated server-side;
- no canonical hidden state sent to clients;
- reconnect tokens are high entropy;
- room codes are not security credentials;
- rate-limit room join attempts;
- sanitize display names;
- reject duplicate/replayed invalid decisions after interaction state has advanced.

## 15. Host privileges

Host may:

- start match when player count is valid;
- request room closure/rematch as defined by UI.

Host may not:

- choose deck order;
- inspect private cards;
- override rules;
- force winners.

## 16. Scaling

Initial release may hold active room state in process memory.

Before horizontal scaling, introduce a room-state strategy such as:

- Redis-compatible session storage;
- sticky sessions;
- or a dedicated stateful game service.

Do not introduce distributed complexity before it is needed.

## 17. Database

PostgreSQL/Neon is not required to prove multiplayer gameplay.

Introduce persistence when implementing features such as:

- match history;
- user accounts;
- analytics;
- durable room recovery;
- moderation.

## 18. Deployment caution

If deploying Socket.IO, select hosting that supports persistent WebSocket connections appropriately.

Do not assume a stateless serverless function model can hold authoritative room memory between requests.
