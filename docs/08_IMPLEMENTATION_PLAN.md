# Implementation Plan

## Milestone 0 — Repository foundation

Create monorepo structure:

```text
power-hungry-pets/
├── apps/
│   ├── web/
│   └── server/
├── packages/
│   ├── game-engine/
│   ├── shared/
│   └── ui/
└── docs/
```

Initial tooling:

- TypeScript
- linting
- formatting
- Jest
- workspace scripts
- CI test command

### Exit criteria

- repository installs cleanly;
- build command works;
- test command works;
- packages can import shared types correctly.

---

## Milestone 1 — Core game model

Implement:

- card types;
- 21-card deck definition;
- unique card instances;
- players;
- round state;
- match state;
- seeded RNG;
- shuffle;
- deal;
- hidden card;
- turn order.

### Exit criteria

All deck/setup tests pass.

---

## Milestone 2 — Base turn engine

Implement:

- begin turn;
- protection expiry hook;
- draw;
- select/play card;
- public discard;
- pending interaction framework;
- advance turn;
- elimination helper;
- round-end checker.

### Exit criteria

A simplified match can progress with placeholder/no-op card effects without invalid state.

---

## Milestone 3 — Card effects

Recommended order:

1. 10 Rey Gato
2. 4 Caparazón
3. 8 Ermitaño
4. 3 Conejito
5. 1 Pecera
6. 5 Serpiente
7. 9 ¡No soy una mascota!
8. 6 Saqueadog
9. 2 Ratón
10. 7 Malabarista
11. 0 Robot end-round rule

Reason:

- start with simple state effects;
- introduce targeting;
- introduce multi-step interactions;
- finish with deck reconstruction and special winner evaluation.

### Exit criteria

All card tests pass.

---

## Milestone 4 — Round and match resolution

Implement:

- last-survivor resolution;
- deck-exhaustion resolution;
- Robot/Rey interaction;
- pairwise direct-win hand comparison with the Robot/Rey exception;
- discard-total tie breaker;
- multiple round winners;
- token award;
- match thresholds;
- shared match victory.

### Exit criteria

All round/match tests pass.

---

## Milestone 5 — Simulation hardening (complete)

Implement:

- legal action generator;
- seeded simulation runner;
- invariant assertions.

Run at least 1,000 legal simulated matches.

### Completed work units

| Work unit | Deliverable | Tests |
|---|---|---|
| 1 | Canonical legal-action generator: `getLegalActions` in `packages/game-engine/src/legal-actions.ts` (engine spec §15.1) | `tests/legal-actions.test.ts` |
| 2 | Typed invariant API: `find*/assert*Invariants` and `InvariantViolationError` in `packages/game-engine/src/invariants.ts` (engine spec §20.1) | `tests/invariants.test.ts` |
| 3 | Deterministic one-draw action policy with separated RNG streams (`simulation-policy.ts`) plus the complete runner `runMatch` (`match-runner.ts`) (engine spec §25) | `tests/simulation-policy.test.ts`, `tests/match-runner.test.ts` |
| 4 | Deterministic >=1,000-match simulation corpus (`tests/simulation.test.ts`) with `SIMULATION_MATCH_COUNT` (default 1000) (test plan §22) | `tests/simulation.test.ts` |

### Exit criteria

- [x] No invariant violation: round invariants are asserted after every round setup, every successful command, and every ended round; match invariants after match creation and every applied round result.
- [x] At least 1,000 legal simulated matches ran clean: 1,000/1,000 corpus matches reached `MATCH_END` across player counts 2–6, exercising both the exhaustion-reveal and last-survivor round-end paths, with zero thrown `SimulationError`, turn-engine rejection, or invariant failure.
- [x] All Milestone 5 test suites pass: the four M5 focused suites (`legal-actions`, `invariants`, `simulation-policy`, `match-runner`) contain 142 declared tests, plus the 5-test corpus suite (`simulation`). Current aggregate suite: 465 tests across 21 suites.
- [x] Same seed and config replay a deep-equal, deeply frozen summary and transcript.

---

## Milestone 6 — Multiplayer server (complete)

NestJS:

- room creation;
- room join;
- room codes;
- host;
- socket binding;
- game session service;
- authoritative command handling;
- public/private projections;
- reconnect token;
- reconnect state restoration.

All items are implemented; see the multiplayer architecture doc (docs/05_MULTIPLAYER_ARCHITECTURE.md) for the authoritative implemented contract and docs/07_TEST_PLAN.md §24 for the test evidence.

### Completed work units

| Work unit | Deliverable | Tests |
|---|---|---|
| 1 | Combined-snapshot public projection: `GameSnapshot` pairing plus `getPublicGameView` in `packages/game-engine/src/views.ts` (engine spec §14.1) | `packages/game-engine/tests/public-view.test.ts` |
| 2 | Player-private projection: `getPlayerPrivateView`, `PrivateGameView`, and typed `ProjectionError` (`PLAYER_NOT_IN_GAME`, `UNKNOWN_PENDING_INTERACTION`) in `packages/game-engine/src/views.ts` (engine spec §14.2) | `packages/game-engine/tests/private-view.test.ts` |
| 3 | In-memory room registry (guarded lifecycle, 32-symbol room codes, socket bindings, SHA-256-only reconnect tokens, host transfer) and the per-socket join rate limiter (8/60s) in `apps/server/src/room/` and `apps/server/src/gateway/join-rate-limiter.ts` | `apps/server/tests/room-registry.test.ts`, `apps/server/tests/join-rate-limiter.test.ts` |
| 4 | Authoritative game-session aggregate (transactional `handleCommand`, per-session engine RNG, invariants, auto-round) plus the fail-closed public-event sanitizer in `apps/server/src/session/` and `apps/server/src/projection/public-events.ts` | `apps/server/tests/game-session.test.ts`, `apps/server/tests/public-events.test.ts` |
| 5 | Real NestJS Socket.IO gateway with typed ack envelopes, runtime payload guards, socket-authenticated membership, and public/private fanout in `apps/server/src/gateway/` (engine spec, multiplayer spec §§4–15) | `apps/server/tests/smoke.test.ts`, `apps/server/tests/gateway-room.test.ts`, `apps/server/tests/gateway-game.test.ts`, `apps/server/tests/gateway-reconnect.test.ts` |
| 6 | Final socket acceptance harness: real Socket.IO clients driving full matches for 2–6 players through the public contract only | `apps/server/tests/multiplayer-e2e.test.ts` |

### Exit criteria

- [x] 2–6 simulated socket clients can complete matches: the acceptance harness (`multiplayer-e2e.test.ts`, one real Socket.IO server, one match per player count 2/3/4/5/6) drives every match exclusively through `room:create`, `room:join`, `room:start`, and `game:command`, asserting per match that every ack succeeds, exactly one seat is authorized per command, `match:ended` occurs, the room reaches FINISHED with in-roster winners, public payloads carry no `instanceId`/reconnect tokens/private state, private fanouts address the right viewer, and no client ever sees another seat's hand identities. Observed passing in 3 repeated runs.
- [x] Server suite green: 9 suites / 139 tests (registry, limiter, session, sanitizer, gateway room/game/reconnect, smoke, e2e).
- [x] Engine suite green: 23 suites / 523 tests, including the default 1,000-match simulation corpus.
- [x] Combined 662 tests green; forced `build`, `lint`, `format:check`, and `jest --detectOpenHandles` all clean.
- [x] Explicitly deferred to later milestones (see docs/09_OPEN_QUESTIONS.md): room TTL/expiry, per-IP/proxy-aware rate limiting, persistence, rematch, spectators, and the frontend (Milestones 7–9).

---

## Milestone 7 — Minimal playable frontend (complete, final socket acceptance green)

Next.js:

- home;
- create/join room;
- lobby;
- game table;
- basic cards/placeholders;
- turn controls;
- target controls;
- private interaction modals;
- round result;
- match result.

Do not prioritize polished artwork yet.

### Completed work units (per delivery commits and code evidence)

| Deliverable | Notes | Tests |
|---|---|---|
| Server-gated turn controls | draw/play rendered only from the viewer's own `legalActions` via the pure `turn-controls` selector | `apps/web/tests/turn-controls.test.ts` |
| Published-target play controls | inline target choices derived only from published target options | `apps/web/tests/game-table.test.tsx`, `apps/web/tests/game-presentation.test.ts` |
| Mandatory private decision modals (WU8) | Pecera/Ratón/Saqueadog private decisions owned by a modal over an inert table | `apps/web/tests/private-decision-modal.test.tsx`, `apps/web/tests/pending-decision.test.ts` |
| Round-result slip (WU9) | live-batch-evidence-only information slip; no modal, no focus trap | `apps/web/tests/round-result.test.ts(x)` |
| Match-result surface (WU10) | projection-derived end-of-match surface replacing the playable table; seated `FINISHED` route; no rematch action | `apps/web/tests/match-result.test.ts`, `apps/web/tests/game-table.test.tsx`, `apps/web/tests/room-page.test.tsx` |

### Evidence limitations

- **WU9 round slip is live-evidence-only.** The slip is captured from the one atomic `game:event` batch that announced the round end; a seat that reconnects after a round ends never receives that batch, so the slip is not restored (recorded as an open question in docs/09_OPEN_QUESTIONS.md). A match-ending round deliberately captures no slip: WU10 owns the match-end presentation.
- **Final socket acceptance is green.** The long socket-flow integration test (`apps/web/tests/socket-flow.integration.test.ts`, "match-end acceptance over real sockets (WU10)") was run by exact `testNamePattern` after `build:packages` and passed end-to-end: full match to `MATCH_END` over real sockets, per-tab winners asserted against one canonical winner list, and a reconnecting seat deriving the result from the restored projection alone (docs/07_TEST_PLAN.md §25).
- The earlier one-failure full-suite state (`round-result.test.tsx` "suppresses the slip entirely when the match has ended (WU10 owns that presentation)") was a test-contract defect, not a production defect: the fixture lacked the authoritative `MATCH_END` projection and the stale assertions queried `role="region"`. Both were fixed without production changes, and the full web suite is now green (docs/07_TEST_PLAN.md §25).

### Exit criteria

- [x] Focused code gates green: `match-result.test.ts`, `game-table.test.tsx`, and `round-result.test.tsx` — 3 suites / 89 tests (observed this pass).
- [x] Full web suite green: 23 suites / 377 tests, including the `room-page.test.tsx` suite (observed this pass).
- [x] Final socket acceptance: the WU10 socket acceptance ran green by exact `testNamePattern` (docs/07_TEST_PLAN.md §25).
- Rematch stays deferred/unsupported: `FINISHED` is terminal, the match-result surface offers no rematch action, and a new game starts with a new room (docs/09_OPEN_QUESTIONS.md).

---

## Milestone 8 — Visual polish (complete)

Delivered:

- projection-confirmed, public-safe motion cues for draw, play, flip, shuffle, swap, and private-decision resolution; cues are derived from sanitized event batches and consumed only after the matching projection arrives;
- textual and visual feedback for protection, forced play, elimination, and victory-token changes without moving rule logic into React;
- a responsive Digital Tabletop Arcade at the 320px floor and across mobile, tablet, and desktop: CSS-only 63:88 stamped card placeholders, distinct table plane, compact public seat avatars, a centered non-interactive action stage, and the viewer's hand as the primary playable band;
- mandatory private-decision modals that keep the visible table inert, trap focus, restore focus, and remain mobile-safe;
- `prefers-reduced-motion` behavior that removes spatial motion while preserving all state and textual feedback;
- final real-browser evidence at `.impeccable/review/m8-table-{desktop,mobile,320,reduced-motion}.png`.

The stable asset-key seam remains configurable. Final artwork, textures, branded frames, and background art remain deferred until usage rights are established. The untracked `docs/10_VISUAL_SYSTEM.md`, `docs/11_CARD_COMPONENT_SPEC.md`, and `docs/12_TABLE_SCENE_SPEC.md` drafts were not adopted as authority and remain untouched.

### Exit criteria

- [x] Visual polish changes no authoritative rule or privacy behavior.
- [x] Projection/event sequencing prevents speculative or replayed action animation.
- [x] Desktop, 390px mobile, and 320px floor captures show no horizontal clipping; the own hand and current action retain priority.
- [x] Reduced-motion capture preserves complete game information without spatial animation.
- [x] Final web suite: 30 suites / 563 tests green; root build, lint, and format checks clean (docs/07_TEST_PLAN.md §26).

---

## Milestone 9 — Deployment and resilience

Implement/test:

- production WebSocket hosting;
- reconnect behavior;
- room expiry;
- basic rate limiting;
- logging;
- error reporting;
- deployment environment configuration.

### Exit criteria

Private online games remain stable under normal disconnect/reconnect scenarios.

---

# Development rules

## Rule 1

Do not build final artwork before the game is mechanically playable.

## Rule 2

Do not put rule logic into React components.

## Rule 3

Do not put authoritative rule decisions into Socket.IO handlers.

Handlers delegate to the game session / engine.

## Rule 4

Do not introduce database/Redis until a concrete requirement needs them.

## Rule 5

Every card implementation requires tests in the same change.

## Rule 6

Any spec change that modifies gameplay must update:

- rules document;
- relevant card catalog entry;
- engine behavior;
- tests.

## Rule 7

Use small implementation changes suitable for independent subagent review.

Recommended task format:

```text
TXXXX — concise title

Scope:
- ...

Read:
- docs/...

Acceptance:
- ...

Tests:
- ...
```
