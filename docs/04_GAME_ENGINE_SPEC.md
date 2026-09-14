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
  | { type: "DUEL_RESOLVED"; actorId: PlayerId; targetId: PlayerId; loserId: PlayerId | null }
  | { type: "HANDS_SWAPPED"; playerIds: [PlayerId, PlayerId] }
  | { type: "HANDS_REVEALED"; hands: RevealedHand[] }
  | { type: "ROUND_ENDED"; winnerIds: PlayerId[] }
  | { type: "TOKEN_AWARDED"; playerId: PlayerId }
  | { type: "MATCH_ENDED"; winnerIds: PlayerId[] };
```

`HANDS_REVEALED` is the draw-pile-exhaustion reveal (rules §9): every surviving player's single hand card is publicly and simultaneously revealed. The reveal moves no cards — hands stay in place — and `HANDS_REVEALED` is always emitted before `ROUND_ENDED`. The last-survivor round end (rules §8) emits no reveal.

`DUEL_RESOLVED` is the Conejito comparison outcome (catalog §3): the challenger, the challenged player, and the loser, or `null` for a tie. It never carries the compared values; a loser's card becomes public only through the `PLAYER_ELIMINATED` reveal that follows it.

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

Implemented (Milestone 6) in `packages/game-engine/src/views.ts` over the combined canonical snapshot §14.1. The projections are pure: every call returns fresh plain objects, no input object or array is aliased, and mutating either side after projection never affects the other.

```ts
getPublicGameView(snapshot: GameSnapshot): PublicGameView
getPlayerPrivateView(snapshot: GameSnapshot, playerId: PlayerId): PrivateGameView
```

A player-private view includes:

- that player's hand (deep copies, `viewerId`'s own cards only);
- the exact canonical `legalActions` for the viewer (`getLegalActions(round, viewerId)`; empty without an attached active round, for a non-actor during a pending stage, or for an eliminated viewer);
- private pending data (`pendingDecision`) only while the viewer is the pending actor: the detached Ratón card on `RATON_INSERT_POSITION`, the hidden card on `SAQUEADOG_SWAP`.

A public view includes:

- players: id, name, connectivity, elimination state, protection state, victory tokens, hand **count**, public discards as `{ value, type }` pairs plus origin;
- the round: status, phase, current actor, turn order, round number, draw-pile **count**, hidden-card **count** (0/1, never identity), the pending interaction's type and actor (plus the Pecera target id), round winners, and the exhaustion reveal §14.3;
- the match frame: id, status, round number, winners.

Never exposed anywhere public: the draw order, hidden card identity, any hidden hand identity, the detached Ratón card, the chosen Ratón insertion index, the Saqueadog hidden card or swap choice, commands, or legal actions.

### 14.1 Combined GameSnapshot input

Projections take one canonical pairing, not a bare state:

```ts
interface GameSnapshot {
  match: MatchState;       // token source of truth, roster, connectivity
  round: RoundState | null; // the live round, or null between rounds / after MATCH_END
}
```

With a round attached, the `players` composition layers two sources: the round's players (in round order) carry the round-owned transient fields — elimination, protection, hand count, public discards — while the match roster keyed by id is authoritative for identity, connectivity (name, `connected`), and the current `victoryTokens`. An attached `ROUND_END` therefore simultaneously shows the tokens the applied round result awarded on the match and the round's public discards, with no array-index coupling between the rosters. With no round attached, the match's players are projected directly (lobby, between rounds, and match end). A malformed roster mismatch falls back to the round's own values per field; projection never validates or rejects.

### 14.2 Player-private projection and typed failures

Authorization runs against the match roster and fails closed: a `playerId` not in the match roster (the single authorization surface — round-side presence alone never authorizes a viewer) throws a typed `ProjectionError` with the stable code `PLAYER_NOT_IN_GAME`, never a null or public fallback.

The pending mapping is exhaustive and fails closed symmetrically with the public projection: any future pending variant the projection does not know how to project safely throws `ProjectionError` with code `UNKNOWN_PENDING_INTERACTION` instead of silently emitting an unsafe shape.

```ts
type ProjectionErrorCode = 'PLAYER_NOT_IN_GAME' | 'UNKNOWN_PENDING_INTERACTION';
class ProjectionError extends Error { readonly code: ProjectionErrorCode }
```

### 14.3 Exhaustion reveal inference in the public view

The public round view carries `revealedHands: PublicRevealedHand[] | null`, inferred from canonical round state (rules §9) so late-joining or reconnecting clients see the same reveal the live `HANDS_REVEALED` event delivered:

- `ROUND_END` + empty draw pile + two or more active players ⇒ every survivor's single hand card is public, as `{ playerId, card: { value, type } }` pairs in round player order, mirroring the canonical emission;
- a last-survivor `ROUND_END` wins immediately with no reveal, so its hand is never exposed (`null`);
- any other shape yields `null`.

The reveal is a projection over hands that stay in place — it moves no cards and never touches discards.

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

### 15.1 Implemented canonical generator (Milestone 5)

`getLegalActions(round: RoundState, actorId?: PlayerId): TurnCommand[]` is implemented in `packages/game-engine/src/legal-actions.ts` as a pure projection of the current round state onto the exact `TurnCommand` objects the turn engine accepts. Legality stays single-sourced in the turn engine's validators and the centralized target-protection seams (`classifyHandTarget`, `hasLegalHandTarget`); the generator owns enumeration and canonical ordering only.

The actor defaults to the round's current player. Terminal and guard results are empty:

- ended rounds (`status !== 'ROUND_ACTIVE'`);
- wrong actor (not the current player while no pending interaction is open);
- eliminated or unknown actors;
- impossible draw states (`DRAW_REQUIRED` with an empty draw pile).

While a pending interaction is open for the actor, only that stage's decision commands are generated:

| Pending stage | Generated commands |
|---|---|
| `PECERA_TARGET` | `CHOOSE_TARGET` for every canonical legal target |
| `PECERA_GUESS` | `SUBMIT_GUESS` with values 0 and 2..10 (prohibited value 1 is a curated illegal input, never generated) |
| `RATON_INSERT_POSITION` | `CHOOSE_DECK_POSITION` with every insertion index `0..drawPile.length` |
| `SAQUEADOG_SWAP` | `CHOOSE_HIDDEN_SWAP` with `swap: false` and `swap: true` |

In `PLAY_REQUIRED` (no pending interaction), every hand card becomes one `PLAY_CARD` action:

- target-bearing cards (3, 5, 8) expand to one action per canonical legal target when at least one exists;
- a target-bearing card with no legal target yields exactly one targetless fizzle action (the engine waives the target requirement);
- non-target cards never carry a stray `targetId`.

Canonical ordering is a stable sort by command type rank — `CHOOSE_DECK_POSITION` (0), `CHOOSE_HIDDEN_SWAP` (1), `CHOOSE_TARGET` (2), `DRAW_CARD` (3), `PLAY_CARD` (4), `SUBMIT_GUESS` (5) — then by card instance id, target id, deck index, and guess value, so identical inputs always produce identical sequences.

The returned commands are fresh plain objects built from public state only; they never alias or leak private card identities and never mutate the input state. Every generated action round-trips through `applyTurnCommand`: a rejection is always the caller's curated illegal input, never a generated one.

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

### 20.1 Implemented invariant API (Milestone 5)

The checks are implemented in `packages/game-engine/src/invariants.ts` as pure, read-only predicates over canonical `RoundState`/`MatchState`:

```ts
findRoundInvariantViolations(round): readonly InvariantViolation[]
assertRoundInvariants(round): void // throws InvariantViolationError
findMatchInvariantViolations(match): readonly InvariantViolation[]
assertMatchInvariants(match): void // throws InvariantViolationError
```

- `InvariantViolation` carries a stable `code` plus a human-readable `detail`; the typed `InvariantViolationError` aggregates every detected violation in one place.
- Round codes: `CARD_CONSERVATION`, `REY_GATO_UNIQUENESS`, `ELIMINATED_PLAYER_STATE`, `CURRENT_ACTOR_STATE`, `PHASE_STRUCTURE`, `PENDING_STRUCTURE`, `ROUND_END_STRUCTURE`, `STATE_SHAPE`.
- Match codes: `MATCH_ROSTER`, `MATCH_TOKENS`, `MATCH_STATUS`, `MATCH_WINNERS`.
- The checks understand every valid transitional state the engine produces: card conservation across hands, discards, draw pile, hidden card, and the detached Ratón pending card; open pending interactions (phase `PLAY_REQUIRED`, the pending actor is the current player holding one card like every other active player); and `MATCH_END` winners that are complete, distinct, and at or above the victory threshold.
- A corrupted (out-of-contract) state yields violations instead of exceptions wherever detectable; the input state is never mutated.

## 21. Error model

Use typed domain errors. There are two disjoint families: turn-engine command rejections carry a `TurnErrorCode`, and match-level resolution rejections raise `MatchResolutionError` with its own `MatchResolutionErrorCode` values. The turn engine never emits match-resolution codes.

Turn-engine `TurnErrorCode` examples:

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
```

Implemented typed failures (Milestone 5):

- the turn engine rejects commands with the `TurnErrorCode` codes above plus `DRAW_PILE_EMPTY`, `INVALID_SWAP_CHOICE`, `INVALID_POSITION`, and `MISSING_RNG` (Card 7 played without the engine RNG dependency);
- match-level resolution (`applyRoundResult`) raises `MatchResolutionError` with the stable codes `MATCH_ALREADY_ENDED`, `ROUND_MATCH_MISMATCH`, `ROUND_NOT_ENDED`, `ROSTER_MISMATCH`, `ROUND_NUMBER_NOT_MONOTONIC`, `ROUND_WINNERS_EMPTY`, `ROUND_WINNERS_DUPLICATED`, and `ROUND_WINNER_NOT_IN_ROSTER` — including the match-end guard that rejects further round results once the match is in `MATCH_END` (§24);
- the simulation runner raises `SimulationError` with stable codes `INVALID_RUNNER_INPUT`, `NO_LEGAL_ACTIONS`, and `GENERATED_ACTION_REJECTED` (carrying the engine rejection code and the rejected command);
- the action policy raises `SimulationPolicyError` with `NO_LEGAL_ACTIONS`.

## 22. Persistence principle

Do not couple the engine to database persistence.

The server may persist snapshots/events outside the engine.

Milestone 6 keeps everything in memory (multiplayer spec §16): no TTL, expiry, persistence, or cross-process recovery exists yet; that is explicitly deferred to later milestones.

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

## 25. Deterministic simulation runner (Milestone 5)

`runMatch(input: MatchRunnerInput): MatchSimulationResult` (implemented in `packages/game-engine/src/match-runner.ts`) hosts the existing engine unchanged and drives complete deterministic matches: create the match, then repeatedly set up rounds and drive them — through the canonical legal-action generator and the deterministic one-draw action policy — until every round reaches `ROUND_END`, applying round results until `MATCH_END`.

### Decisions at a glance

| Topic | Decision |
|---|---|
| Randomness separation | Two independent `SeededRng` streams are derived reproducibly from `(seed, streamName)` through a deterministic FNV-1a-style hash plus an avalanche mix: the `engine` stream (deck shuffle, every round starter, card-effect randomness such as Card 7) and the `policy` stream (exactly one draw per action decision). Action-selection changes can never perturb engine, deck, or card-effect randomness. |
| Round starter | Every round — including the first — draws a fresh random starter from the engine RNG (`randomFirstPlayerPolicy` by default, injectable through `firstPlayerPolicy` without changing setup). Previous winners never influence the starter. |
| Action policy | `selectLegalAction` reduces `getLegalActions`' canonical list with exactly one RNG draw; legality and ordering stay single-sourced in the legal-action generator. |
| Failure discipline | An engine-rejected generated action raises the typed `SimulationError` with `GENERATED_ACTION_REJECTED` (carrying the engine rejection code and the rejected command); an empty legal-action list while a round is active raises `NO_LEGAL_ACTIONS`. The runner never retries, mutates around, or hides an engine rejection. |
| Budgets | `maxRounds` and `maxCommandsPerRound` (both positive integers, defaults 1,000/1,000 in the frozen `DEFAULT_MATCH_RUNNER_CONFIG`). Exhausting a budget ends the run gracefully with `ROUND_BUDGET_EXCEEDED` or `COMMAND_BUDGET_EXCEEDED` — it is never an error. |
| Input guards | Nonnegative integer seed; exactly one of `players` (2–6 entries with unique nonempty string ids, copied so the caller's array is never mutated) or `playerCount` (2–6, generated roster `p1..pN`); positive-integer config. Every violation is normalized to the typed `INVALID_RUNNER_INPUT` error. |
| Determinism | Same seed and config always replay a deep-equal, deeply frozen summary and transcript. |

### Invariant assertions around every transition

- after match creation and every applied round result: `assertMatchInvariants`;
- after round setup, every successful command, and every ended round: `assertRoundInvariants`.

### Transcript and summary

- One `COMMAND` transcript entry per applied command (round number, command, public events) and one `ROUND_RESULT` entry per ended round (round number, starter, winners, result events).
- The summary carries seed, match id, player count, termination mode, match status, winners, rounds played, per-round starter/winners/command/event counts, total commands, and the transcript-wide event total (including events from a partial round under budget termination).
- Per-round accounting always reconciles: command entries, round-result entries, round numbers, and event sums reproduce the summary totals.
