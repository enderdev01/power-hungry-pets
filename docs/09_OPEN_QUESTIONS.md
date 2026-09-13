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

## Resolved for Milestone 6 (multiplayer server)

The following were decided while implementing Milestone 6; the implemented behavior in `apps/server` and `packages/game-engine/src/views.ts` is authoritative (see docs/05_MULTIPLAYER_ARCHITECTURE.md and docs/04_GAME_ENGINE_SPEC.md §14).

### Room code format

**Decision:** Room codes are 5 characters over a 32-symbol unambiguous alphabet: Crockford base32 — digits `0-9` plus `A-Z` without `I`, `L`, `O`, `U` — so every glyph maps to exactly one symbol (no O/0, I/L/1, or U/V confusion). Codes are crypto-random, collision-checked with bounded retries, and are matchmaking handles, not security credentials.

**Status:** Resolved by project decision (Milestone 6).

### Reconnect token handling

**Decision:** Tokens are 32 crypto-random bytes, base64url-encoded, handed to the client exactly once at create/join. The registry retains only the SHA-256 hash and verifies reconnects by constant-time hash comparison (`timingSafeEqual`); no snapshot ever contains token material. There is no token expiry: a token is valid for the in-memory lifetime of its room.

**Status:** Resolved by project decision (Milestone 6).

### Client event granularity

**Decision:** One gameplay event, `game:command`, carrying the exact engine `TurnCommand`, instead of per-action event names (`game:draw`, `game:play-card`, …). The gateway validates command shape only; the session validates semantics. The speculative `match:rematch` event is not implemented.

**Status:** Resolved by project decision (Milestone 6).

### Disconnect during a match

**Decision:** No grace timer, no forfeit, no auto-play, no turn skip. A disconnect only flips the seat's transport `connected` overlay; the seat, token, and host status are retained and the engine waits for the player's legal action or pending decision. Explicit `room:leave` is rejected during `IN_MATCH` (disconnect is the supported pause path); leaves are allowed in `CREATED`, `LOBBY`, and `FINISHED`, and the last seat leaving deletes the room and its session.

**Status:** Resolved by project decision (Milestone 6). The broader timeout/forfeit product question remains open under "Disconnect forfeit" below.

### Host transfer on leave

**Decision:** When the host explicitly leaves, host privileges transfer to the earliest-joined connected remaining seat, falling back to the earliest remaining seat when none are connected. Disconnect never transfers the host role.

**Status:** Resolved by project decision (Milestone 6).

### Exhaustion reveal in reconnected/late views

**Decision:** The public projection infers the draw-pile-exhaustion reveal from canonical state (`ROUND_END` + empty draw pile + ≥2 active players ⇒ survivor hands exposed as value/type pairs; a last-survivor end reveals nothing) so clients that missed the live `HANDS_REVEALED` event — late joiners, reconnecting seats — see the same reveal.

**Status:** Resolved by project decision (Milestone 6).

### Join rate limiting scope

**Decision:** The MVP limiter keys per socket connection: 8 `room:join` attempts per 60 s sliding window, counted before payload validation. It never limits already-bound gameplay. Per-remote-address keying and proxy-aware trusted-address extraction are deliberately deferred to a later milestone, where the real client address can be trusted at the transport/proxy layer (the existing class can be reused with an address key unchanged).

**Status:** Resolved by project decision (Milestone 6); address/proxy hardening deferred (Milestone 9).

## Explicitly deferred from Milestone 6

Deliberate deferrals recorded so later milestones pick them up intentionally (docs/05_MULTIPLAYER_ARCHITECTURE.md §19, implementation plan Milestones 7–9):

- **Room TTL / expiry / token expiry** — none exists; rooms and tokens live for the process lifetime, and the `EXPIRED` status is reachable only in principle.
- **Per-IP / proxy-aware rate limiting** — per-socket limiting only (see above).
- **Persistence** — everything is in-memory; a restart loses rooms, sessions, and tokens.
- **Rematch** — `FINISHED` is terminal short of `EXPIRED`; no rematch flow or event exists. Reconciled with the frontend in Milestone 7 (WU10): the match-result surface offers no rematch action and states copy-only that a new game starts with a new room. Rematch remains deferred/unsupported.
- **Spectators** — every seat is a player; no observer role exists.
- **Frontend** — Milestone 7; the socket contract is exercised only by real Socket.IO test clients.

## Still open

### Exact visual assets

Final artwork distribution rights are not established.

Development should use placeholders or assets the project is authorized to use.

### Disconnect forfeit

No rule currently specifies what happens when a disconnected player does not return.

Milestones 5–6 preserve the seat, token, and host status on disconnect and pause rather than auto-play cards; explicit leave is rejected mid-match.

A later product decision may add a timeout/forfeit policy (Milestone 9 candidate).

### Round slip after a reconnect

Context:
The WU9 round-result slip is captured only from the one atomic `game:event` batch that announced the round end; a seat that reconnects after a round ends never receives that batch, so the slip is not restored. The public projection does not re-publish a past round's result, and a match-ending round deliberately captures no slip (WU10 owns match-end presentation from the projection).

Options:
1. Keep the slip as live-evidence-only (current): honest, never stale, no protocol change; a reconnected seat simply never sees past round slips.
2. Extend the public projection with the last ended round's result so reconnects can re-derive the slip.

Affected:
- UI
- engine/protocol (option 2 only)
- tests

Status: OPEN

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
