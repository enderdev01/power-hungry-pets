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

## Milestone 6 — Multiplayer server

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

### Exit criteria

2–6 simulated socket clients can complete matches.

---

## Milestone 7 — Minimal playable frontend

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

### Exit criteria

A complete online match is playable in browser.

---

## Milestone 8 — Visual polish

Add:

- card movement;
- flips;
- shuffle;
- swaps;
- protection indicator;
- forced play;
- elimination;
- victory token animation;
- responsive mobile layout;
- reduced-motion support.

### Exit criteria

Game feels polished without changing rules behavior.

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
