# Open Questions and Explicit Project Resolutions

This file contains unresolved questions and project-level interpretations.

Agents must not silently invent answers.

## Resolved for the digital adaptation

### Shared match victory

If multiple players receive a round token and cross the match victory threshold in the same round, all qualifying players are declared joint match winners.

**Status:** Resolved by project decision.

### Equal hand values in Conejito comparison

If the two compared hand values are equal, nobody is eliminated.

**Status:** Project interpretation consistent with the comparison rule.

### Protected Rey Gato holder vs card 9

A protected player's hand cannot be manipulated. Therefore card 9 cannot force an exchange with a protected Rey Gato holder.

**Status:** Project interpretation based on Caparazón wording.

### Malabarista and protection

Malabarista is treated as a global round-state reset of active hands rather than an opponent targeting/manipulating a protected player's hand. Protected active players therefore also return their hand and receive a new one.

Protection status itself remains in force until its normal expiry unless a later rule explicitly says otherwise.

**Status:** Project interpretation.

### Deck total

**Decision:** The canonical deck contains **21 cards**. Every per-value quantity remains unchanged: 0 ×1, 1 ×5, 2 ×3, 3 ×3, 4 ×2, 5 ×2, 6 ×1, 7 ×1, 8 ×1, 9 ×1, and 10 ×1.

Historical context: the rules and tests previously asserted 22 cards while these canonical quantities total 21, blocking Milestone 1 deck and round setup validation.

**Status:** Resolved by authoritative user decision.

### Robot implementation milestone

Card 0 Robot's end-of-round interaction requires the complete winner-resolution rules. Implement and test that interaction in Milestone 4 together with hand-value comparison, the discard tie-breaker, and round winners rather than introducing a partial resolver in Milestone 3.

**Status:** Resolved by authoritative user decision.

### Privacy scope for Milestone 3

Milestone 3 card effects must not expose private card information through public domain events. Public and player-private state projections remain Milestone 6 work as scheduled in the implementation plan.

**Status:** Resolved by authoritative user decision.

### Serpiente replacement with an empty draw pile

If Serpiente forces a player to discard their hand and the draw pile has no replacement card, that player is eliminated immediately from the round. The forced discard remains public and follows the normal elimination lifecycle.

**Status:** Resolved by authoritative user decision.

### Target-requiring cards with no legal target

When a target-requiring card (1 Pecera, 3 Conejito, 5 Serpiente, 8 Ermitaño) is played and zero legal opponent targets exist, the card is still played face up into the discard pile and its targeting effect does nothing. Self is never a legal target, and selecting an invalid target while at least one legal target exists is rejected as an invalid action.

**Status:** Resolved by authoritative user decision (Milestone 3).

### Ratón Trampero with an empty main draw pile

If the main draw pile is empty when Ratón Trampero is played, there is no card to inspect or reinsert: the effect fizzles, no insertion decision is created, the hidden card is not used or nulled, and normal draw-pile exhaustion resolution follows. Accordingly, the `RATON_INSERT_POSITION` pending interaction carries the inspected `card: CardInstance` as private detached state while it is out of the draw pile.

**Status:** Resolved by authoritative user decision (Milestone 3).

### Simultaneous hand reveal on draw-pile exhaustion

When the draw pile is exhausted with two or more active players, all surviving players simultaneously publicly reveal their one remaining hand card. The reveal moves no cards: revealed cards stay in their owners' hands and are not placed in discards. The engine emits `HANDS_REVEALED` immediately before `ROUND_ENDED`. The last-survivor round end performs no reveal.

**Status:** Resolved by authoritative user decision (Milestone 4).

### End-of-round winner resolution: direct pairwise comparison

Round winners are not chosen by a single highest-hand-value criterion. Every pair of surviving players is compared directly: the higher value wins the pair, equal values win the pair for nobody, and the special 0-vs-10 relationship applies within the pair — Robot Aspirador Real beats Rey Gato directly, loses normally to every other higher value, and Rey beats every non-Robot hand. Each player's direct pairwise wins are counted; the maximal-count players are the winner candidates; the discard-total tie breaker applies only among them; an exact remaining tie yields multiple round winners.

**Status:** Resolved by authoritative user decision (Milestone 4).

### Card 0 has no printed action

Card 0 (Robot Aspirador Real) has no face-up printed action. Its only rule contribution is the special relationship inside end-of-round winner evaluation; it does nothing when played during a normal turn beyond being placed face up in the discard area.

**Status:** Resolved by authoritative user decision (Milestone 4).

### First player of a new match / next round

**Decision:** Every round — including the first — gets a starter drawn randomly from the engine's RNG stream. The implementation ships `randomFirstPlayerPolicy` as the default first-player policy, injectable through the `firstPlayerPolicy` seam (`MatchRunnerInput.firstPlayerPolicy` forwarded to `setupRound` unchanged), and previous round winners never influence the starter. The runner records each round's starter in the transcript and summary for reproducibility.

Historical context: the original rules specification did not define who starts the first or subsequent rounds, so the question was parked with a temporary development default (random first round, previous winner afterwards). That temporary default is superseded by the decision above and was never treated as official physical-game canon.

**Status:** Resolved by project decision (Milestone 5).

## Still open

### Exact visual assets

Final artwork distribution rights are not established.

Development should use placeholders or assets the project is authorized to use.

### Disconnect forfeit

No rule currently specifies what happens when a disconnected player does not return.

MVP should preserve the seat and pause/offer room-level handling rather than auto-play cards.

A later product decision may add a timeout/forfeit policy.

## How to add a question

Use:

```text
### Question title

Context:
...

Options:
1. ...
2. ...

Affected:
- rules
- engine
- UI
- tests

Status: OPEN
```
