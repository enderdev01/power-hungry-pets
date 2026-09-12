# Game Engine Specification

## 1. Design objective

Create a pure TypeScript game engine that contains all rules and can run without:

- browser APIs;
- React;
- Next.js;
- NestJS;
- Socket.IO;
- a database.

The server application will call this engine.

## 2. Suggested package

```text
packages/
└── game-engine/
    ├── src/
    │   ├── cards/
    │   ├── commands/
    │   ├── engine/
    │   ├── events/
    │   ├── models/
    │   ├── rules/
    │   ├── rng/
    │   └── views/
    └── tests/
```

## 3. Core state

Illustrative model:

```ts
type PlayerId = string;
type CardInstanceId = string;

interface GameState {
  matchId: string;
  status: "LOBBY" | "ROUND_ACTIVE" | "ROUND_END" | "MATCH_END";

  players: PlayerState[];
  turnOrder: PlayerId[];
  currentPlayerId: PlayerId | null;

  roundNumber: number;

  drawPile: CardInstance[];
  hiddenCard: CardInstance | null;

  pendingInteraction: PendingInteraction | null;

  winners: PlayerId[];
}

interface PlayerState {
  id: PlayerId;
  name: string;

  connected: boolean;
  eliminated: boolean;
  protected: boolean;

  hand: CardInstance[];
  discards: CardInstance[];

  victoryTokens: number;
}

interface CardInstance {
  instanceId: CardInstanceId;
  value: number;
  type: CardType;
}
```

Exact naming may differ, but the semantics must remain.

## 4. Unique card instances

Every physical copy is represented by a unique `instanceId`.

Never identify a card in a player's hand only by numeric value because multiple identical copies exist.

## 5. Command model

State changes occur through validated commands.

Examples:

```ts
type GameCommand =
  | { type: "START_MATCH"; actorId: PlayerId }
  | { type: "DRAW_CARD"; actorId: PlayerId }
  | { type: "PLAY_CARD"; actorId: PlayerId; cardInstanceId: string }
  | { type: "CHOOSE_TARGET"; actorId: PlayerId; targetId: PlayerId }
  | { type: "SUBMIT_GUESS"; actorId: PlayerId; value: number }
  | { type: "CHOOSE_DECK_POSITION"; actorId: PlayerId; index: number }
  | { type: "CHOOSE_HIDDEN_SWAP"; actorId: PlayerId; swap: boolean };
```

The exact command set may be refined, but all player decisions must be explicit.

## 6. Pending interactions

Multi-step cards must pause the normal turn until the required decision is received.

Example states:

```ts
type PendingInteraction =
  | {
      type: "PECERA_TARGET";
      actorId: PlayerId;
    }
  | {
      type: "PECERA_GUESS";
      actorId: PlayerId;
      targetId: PlayerId;
    }
  | {
      type: "RATON_INSERT_POSITION";
      actorId: PlayerId;
      card: CardInstance;
    }
  | {
      type: "SAQUEADOG_SWAP";
      actorId: PlayerId;
    }
  | null;
```

While a pending interaction exists, unrelated commands must be rejected.

`RATON_INSERT_POSITION` carries the detached card itself (`card: CardInstance`) rather than only an instance ID. During inspection the card is detached from the draw pile and held inside the pending interaction, so every card instance still exists in exactly one location and the conservation invariant holds. The pending interaction is private state: `card` may appear only in the acting player's player-private projection and must never appear in public events or projections.

This pending interaction is created only when a main draw-pile card exists to inspect. If the main draw pile is empty when Ratón Trampero is played, the effect fizzles without creating any pending interaction and without using or nulling the hidden card.

## 7. Domain events

The engine returns domain events describing what happened.

Example:

```ts
type GameEvent =
  | { type: "CARD_DRAWN"; playerId: PlayerId }
  | { type: "CARD_PLAYED"; playerId: PlayerId; card: PublicCard }
  | { type: "PLAYER_PROTECTED"; playerId: PlayerId }
  | { type: "PROTECTION_EXPIRED"; playerId: PlayerId }
  | { type: "PLAYER_ELIMINATED"; playerId: PlayerId }
  | { type: "HANDS_SWAPPED"; playerIds: [PlayerId, PlayerId] }
  | { type: "HANDS_REVEALED"; hands: RevealedHand[] }
  | { type: "ROUND_ENDED"; winnerIds: PlayerId[] }
  | { type: "TOKEN_AWARDED"; playerId: PlayerId }
  | { type: "MATCH_ENDED"; winnerIds: PlayerId[] };
```

`HANDS_REVEALED` is the draw-pile-exhaustion reveal (rules §9): every surviving player's single hand card is publicly and simultaneously revealed. The reveal moves no cards — hands stay in place — and `HANDS_REVEALED` is always emitted before `ROUND_ENDED`. The last-survivor round end (rules §8) emits no reveal.

Events must not accidentally contain secret card data in their public form.

## 8. Transactional command processing

A command must behave atomically:

1. validate command;
2. compute transition;
3. apply complete transition;
4. emit events.

On validation failure:

- return a typed error;
- do not partially mutate state.

## 9. RNG

Randomness is used for:

- deck shuffle;
- any future rule explicitly requiring random choice.

The engine must receive RNG as a dependency.

Production may use a secure/random source.

Tests must be able to use a seeded deterministic RNG.

Example:

```ts
createGameEngine({
  rng: new SeededRng(12345)
});
```

## 10. Turn lifecycle

A normal turn:

```text
BEGIN_TURN
  ↓
expire acting player's protection
  ↓
DRAW_REQUIRED
  ↓
player draws
  ↓
PLAY_REQUIRED
  ↓
player selects card
  ↓
card enters public discard area
  ↓
resolve effect / pending interaction
  ↓
resolve eliminations
  ↓
check round end
  ↓
ADVANCE_TURN
```

Implementation may combine internal states, but must preserve this behavior.

## 11. Round end checks

Round-end checks must be centralized.

Check at minimum after:

- any elimination;
- completion of a card effect;
- a forced play;
- a replacement draw if applicable;
- a normal turn if the draw pile has become unable to support the next required normal draw.

Do not duplicate inconsistent end-of-round logic across card handlers.

## 12. End-of-round winner resolver

Implement a dedicated rule module.

Suggested function:

```ts
resolveRoundWinners(state: GameState): PlayerId[]
```

It must handle:

1. last active survivor;
2. draw-pile exhaustion: simultaneous `HANDS_REVEALED` reveal of all surviving hands, without moving cards;
3. direct pairwise winner resolution (Robot/Rey special interaction, higher value, equal = no pair win), counting each player's pairwise wins;
4. discard-total tie breaker among the maximal pairwise-win candidates only;
5. multiple winners after an exact discard-total tie.

The resolver reads the pre-reveal state and never mutates it: the exhaustion reveal moves no cards, so discard totals remain unaffected by the reveal.

## 13. Card handlers

Each card should have its own rule module or handler.

Example:

```text
cards/
├── card-0-robot.ts
├── card-1-pecera.ts
├── card-2-raton.ts
├── card-3-conejito.ts
├── card-4-caparazon.ts
├── card-5-serpiente.ts
├── card-6-saqueadog.ts
├── card-7-malabarista.ts
├── card-8-ermitano.ts
├── card-9-no-soy-mascota.ts
└── card-10-rey-gato.ts
```

Avoid a single giant `switch` that owns all business logic.

A small dispatch switch/map is acceptable.

## 14. Public and private projections

The canonical server state must never be sent directly to clients.

Create projections:

```ts
getPublicGameView(state)
getPlayerPrivateView(state, playerId)
```

A player-private view may include:

- that player's hand;
- private card information currently being inspected;
- legal decisions for a pending interaction.

A public view may include:

- players;
- elimination state;
- protection state;
- public discards;
- deck count;
- hidden card existence, but not identity;
- current turn;
- scores.

## 15. Legal-action computation

Prefer the server/engine to compute allowed actions.

Example:

```ts
getLegalActions(state, playerId)
```

This reduces invalid client behavior but does not replace server-side command validation.

For target-requiring cards (1, 3, 5, 8), legal-action computation must distinguish two cases:

- when no legal target exists, playing the card remains valid and its targeting effect resolves as a no-op;
- when at least one legal target exists, selecting an illegal target (self, eliminated, protected) must fail with the typed error (`ILLEGAL_TARGET` / `TARGET_PROTECTED`).

## 16. Protection helper

Use one canonical rule for protection checks.

Example:

```ts
canTargetHand(state, actorId, targetId): boolean
```

Card handlers should not reimplement protection semantics independently.

## 17. Elimination helper

Elimination must be centralized because it may:

- reveal the current hand;
- add a public card to the player's area;
- trigger Rey Gato behavior consistently;
- remove the player from turn rotation;
- cause immediate round end.

## 18. Card 5 special engine behavior

Serpiente Encantadora forces a face-up play with:

```ts
resolvePrintedAction = false
```

The engine must still evaluate intrinsic face-up triggers.

This distinction is mandatory.

## 19. Card 7 special engine behavior

Malabarista must:

- return only active players' current hands;
- keep all public discards outside the shuffle;
- keep hidden card outside the shuffle;
- shuffle the reconstructed draw pile;
- redeal exactly one card to each active player.

## 20. State invariants

Assertions should verify, at least in development/tests:

- no active player normally has more than 2 cards;
- outside draw/play transition, active players normally have exactly 1 hand card;
- eliminated players have zero hand cards after elimination resolution;
- every card instance exists in exactly one location;
- hidden card count is 1 while round is active, unless a rule intentionally changes identity by swap;
- there is exactly one Rey Gato instance;
- turn player is active;
- protected flag belongs only to an active player;
- public/private projections do not expose unauthorized hidden cards.

## 21. Error model

Use typed domain errors.

Examples:

```ts
NOT_YOUR_TURN
PLAYER_ELIMINATED
CARD_NOT_IN_HAND
ILLEGAL_TARGET
TARGET_PROTECTED
INVALID_GUESS
PENDING_DECISION_REQUIRED
UNEXPECTED_COMMAND
ROUND_ALREADY_ENDED
MATCH_ALREADY_ENDED
```

## 22. Persistence principle

Do not couple the engine to database persistence.

The server may persist snapshots/events outside the engine.

## 23. Serialization

State and events must be serializable.

Avoid class instances that require non-trivial hydration unless there is a clear mapper.

Plain-data state with pure functions is preferred.

## 24. Round result and match flow

The match is the token source of truth. When a round ends, a pure match-level resolution applies the round result:

1. Validate the ended round transactionally: same match, `ROUND_END` status, same roster, monotonic round number, and non-empty distinct roster-member winners. Any violation is a typed error with no partial mutation.
2. Award exactly one victory token to every distinct round winner; each award emits one `TOKEN_AWARDED` event.
3. Apply the victory thresholds (rules §3): **3 tokens** for 2–3 players, **2 tokens** for 4–6 players.
4. Every player at or above the threshold is a match winner. If at least one exists, the match status becomes `MATCH_END` with a single `MATCH_ENDED` event carrying all joint winners (shared victory, rules §11); every `TOKEN_AWARDED` precedes that single `MATCH_ENDED`.
5. Otherwise the match status becomes `ROUND_END` and the next round begins.

While the match is in `MATCH_END`, no further round results can be applied: the match-end guard rejects them transactionally.
