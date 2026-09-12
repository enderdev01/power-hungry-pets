# Test Plan

## 1. Goal

The game engine must be trustworthy before multiplayer UI polish begins.

Tests are mandatory for rule implementation.

## 2. Test layers

### Unit tests

Pure rules and helpers.

### Engine integration tests

Commands through complete state transitions.

### Multiplayer integration tests

Gateway/session handling with multiple simulated clients.

### End-to-end tests

Browser-level critical flows after engine/network stability.

## 3. Deck tests

Verify:

- deck has exactly 21 cards;
- quantities are exactly:
  - 0 ×1
  - 1 ×5
  - 2 ×3
  - 3 ×3
  - 4 ×2
  - 5 ×2
  - 6 ×1
  - 7 ×1
  - 8 ×1
  - 9 ×1
  - 10 ×1
- every card instance ID is unique;
- exactly one Rey Gato exists;
- deterministic shuffle works with seeded RNG.

## 4. Round setup tests

For 2–6 players:

- each player receives exactly one card;
- exactly one hidden card exists;
- remaining draw-pile size is correct;
- all players are active;
- all players are unprotected;
- discard piles are empty.

## 5. Turn tests

Verify:

- only current player can act;
- normal draw produces two-card decision state;
- player can play only a card actually held;
- played card becomes public discard;
- player retains exactly one card after normal play;
- turn advances to next active player;
- eliminated players are skipped.

## 6. Card 0 tests

At minimum:

- Robot beats Rey Gato in the direct end-of-round pairwise comparison.
- Robot does not globally beat a non-Rey higher value.
- Rey still beats every non-Robot hand in a direct comparison.
- Special relationship is evaluated correctly in multiplayer winner resolution.
- Card 0 has no face-up printed action when played during a turn.

## 7. Card 1 tests

- cannot target self;
- cannot target eliminated player;
- cannot target protected player;
- guess value 1 is rejected;
- correct guess eliminates target;
- incorrect guess does not reveal target hand;
- wrong guess does not eliminate target;
- no legal target exists => card is still discarded with no effect.

## 8. Card 2 tests

- removes top draw card temporarily;
- actor can privately inspect it;
- empty main draw pile: no inspection interaction, hidden card untouched, effect fizzles;
- card can be inserted at top;
- card can be inserted in middle;
- card can be inserted at bottom;
- deck size unchanged after completion;
- other player projection never exposes inspected card;
- insertion index never leaks publicly.

## 9. Card 3 tests

- lower hand is eliminated;
- equal hands eliminate nobody;
- protected target illegal;
- no legal target exists => card is still discarded with no effect;
- values are not publicly exposed by comparison alone.

## 10. Card 4 tests

- actor becomes protected;
- protection blocks cards 1, 3, 5, 8 and 9 hand manipulation;
- protection expires at beginning of owner's next turn;
- protection does not persist one turn too long.

## 11. Card 5 tests

- target's hand is placed face up;
- forced card's printed action is not executed;
- active target draws replacement immediately;
- forced Rey Gato eliminates target;
- eliminated target does not draw replacement;
- protected target illegal;
- no legal target exists => nothing is forced face up, no replacement draw, card still discarded.

Critical regression:

```text
Serpiente -> force Rey Gato -> elimination
```

must be permanently covered.

## 12. Card 6 tests

- actor privately sees hidden card;
- keep leaves state unchanged;
- swap exchanges hand and hidden card;
- public view exposes neither card;
- hidden-card slot remains exactly one card.

## 13. Card 7 tests

- all active hands returned;
- eliminated players contribute no hand;
- played card 7 stays in discard;
- hidden card stays hidden/outside shuffle;
- previous discards stay outside shuffle;
- returned hands + draw pile are shuffled;
- every active player receives exactly one new hand card;
- card conservation invariant holds.

## 14. Card 8 tests

- swaps acting player's remaining hand with legal target;
- neither card becomes public;
- protected target illegal;
- eliminated target illegal;
- no legal target exists => card is still discarded with no exchange.

## 15. Card 9 tests

- finds another active Rey Gato holder and swaps;
- no Rey holder => no effect;
- protected Rey holder => no exchange;
- private projections update correctly;
- unrelated hand values never leak.

## 16. Card 10 tests

Rey Gato eliminates holder when face up because of:

- voluntary play;
- Serpiente forced play;
- elimination reveal;
- any generic face-up path implemented by engine.

Ensure its separate printed action is not required to trigger elimination.

## 17. Elimination tests

- revealed hand is public;
- printed effect of eliminated player's revealed hand does not resolve;
- eliminated player removed from turn order;
- last active player wins immediately.

## 18. Round-end tests

Last survivor:

- last survivor wins immediately;
- last-survivor round end emits no `HANDS_REVEALED` reveal.

Draw pile exhaustion (2+ active players):

- exhaustion triggers a simultaneous public reveal of every survivor's hand (`HANDS_REVEALED`);
- `HANDS_REVEALED` precedes `ROUND_ENDED`;
- the reveal moves no cards: hands stay in place and are not added to discards;
- winner resolution uses direct pairwise comparisons over the revealed hands;
- higher hand value wins its pair; equal values win no pair;
- Robot beats Rey Gato in their direct pair; Robot loses normally to other higher values; Rey beats every non-Robot;
- the player with the most pairwise wins wins the round;
- pairwise-win tie uses discard totals among tied candidates only;
- highest discard total wins;
- exact discard tie gives multiple round winners;
- every winner receives one token.

## 19. Match-end tests

2–3 players:

- match ends at 3 tokens.

4–6 players:

- match ends at 2 tokens.

Shared victory:

- multiple round winners can cross threshold simultaneously;
- all qualifying players are declared joint match winners.

Event flow:

- every `TOKEN_AWARDED` precedes the single `MATCH_ENDED`;
- once in `MATCH_END`, applying another round result is rejected transactionally.

## 20. Information-security tests

For every card and interaction, verify another player's client view never receives:

- hidden card identity;
- other player's current hand;
- full draw-pile order;
- Ratón inspected card;
- Ratón insertion index;
- Saqueadog hidden-card identity;
- secret swap decision details unless intentionally public.

## 21. Property/invariant tests

Useful invariant checks after every command:

- every card instance is in exactly one location;
- total card count remains 21;
- only active players hold cards;
- hidden slot contains exactly one card during an active round;
- no duplicate instance IDs;
- current player is active;
- no unresolved pending interaction is bypassed.

Implemented as the typed invariant API (engine spec §20.1): `assertRoundInvariants`/`assertMatchInvariants` throw a single `InvariantViolationError` aggregating every stable-coded violation, and the finders stay pure and read-only. Covered in `tests/invariants.test.ts`: every real engine flow (all card paths, both round-end paths, the next round after a result) is accepted, while single-card and single-structural corruptions are each flagged with the correct code.

## 22. Simulation tests

Implemented as the deterministic simulation corpus (`tests/simulation.test.ts`, Milestone 5 work unit 4).

Command:

```bash
npx jest --config jest.config.cjs --runInBand tests/simulation.test.ts
```

`SIMULATION_MATCH_COUNT` (positive integer, default 1000) controls the corpus size; unset or blank falls back to 1000 and CI can shrink or grow it deliberately (a reduced corpus logs a warning).

Verified properties:

- the corpus uses stable seeds (base 1,000 + index) spread deterministically across player counts 2–6;
- every run reaches `MATCH_END` with nonempty, distinct, roster-member winners;
- transcript accounting is coherent: one `COMMAND` entry per applied command, one `ROUND_RESULT` per ended round, per-round command/event counts matching the summary, consecutive round numbers, and all event sums reconciling to `totalEvents`;
- no run throws a `SimulationError`, turn-engine rejection, or invariant failure (throws escape with seed and playerCount diagnostics);
- both round-end paths occur across the corpus: at least one exhaustion-reveal round (`HANDS_REVEALED` during the round's commands) and at least one last-survivor round (no reveal in that round);
- determinism is verified by bounded deep-equal replay of representative samples (one per player count plus the middle and last corpus indices), not by doubling the whole corpus.

Observed evidence: 1,000/1,000 corpus matches reached `MATCH_END` across player counts 2–6, exercising both the exhaustion-reveal and last-survivor round-end paths, with zero thrown invariant/engine errors.

Simulation is supplementary; it does not replace explicit rules tests.

## 23. Milestone 5 hardening tests

Implemented in `tests/legal-actions.test.ts`, `tests/simulation-policy.test.ts`, and `tests/match-runner.test.ts`.

### Legal actions (`getLegalActions`)

- terminal and actor guards return empty (ended rounds, wrong/unknown/eliminated actors);
- per-stage pending expansion and the `PLAY_REQUIRED` hand expansion (including the targetless fizzle and the exclusion of self/protected/eliminated targets);
- canonical stable ordering by command type, card, target, index, and value, deterministic across repeated calls;
- purity (input never mutated) and round-trip of every generated action through `applyTurnCommand`;
- curated illegal inputs remain rejected (protected/self/eliminated targets, guess value 1 and out-of-range values, out-of-range insertion indices, wrong pending-stage commands, Card 7 without the engine RNG).

### Action policy and RNG streams

- `selectLegalAction` chooses exactly one canonical action with exactly one RNG draw and raises the typed `SimulationPolicyError` (`NO_LEGAL_ACTIONS`) on an empty list;
- `(seed, streamName)` derivation is reproducible and independent across streams (`engine` vs `policy`).

### Simulation runner (`runMatch`)

- complete matches for every generated player count 2–6 and explicit rosters, with a typed guard per invalid input (playerCount bounds, missing/ambiguous roster, malformed/duplicate/empty explicit ids, untouched caller roster);
- fresh starter for every round through the engine RNG: the same seed replays the same starter sequence, and the starter is not inherited from the previous round's winners;
- graceful budget termination (`ROUND_BUDGET_EXCEEDED`, `COMMAND_BUDGET_EXCEEDED`) with correct partial-round event accounting, plus typed deadlock detection (`NO_LEGAL_ACTIONS`) and generated-action rejection mapping (`GENERATED_ACTION_REJECTED` with engine code and command);
- invariant assertions around every transition (round after setup/every command/round end; match after creation/every applied result);
- transcript entry-per-command/result accounting and transcript-wide event totals on both `MATCH_END` and budget paths;
- deeply frozen, deep-equal results for identical seed/config and different transcripts for different seeds.
