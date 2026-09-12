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

## 22. Simulation tests

Once basic tests pass, simulate large numbers of seeded matches.

Target:

- at least 1,000 deterministic random legal simulations during development;
- no invariant violations;
- no impossible state;
- every simulation reaches a round/match termination condition.

Simulation is supplementary; it does not replace explicit rules tests.
