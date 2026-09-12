# Power Hungry Pets — Agent Brief

## Purpose

This repository will implement a **non-commercial digital adaptation** of the physical card game **Power Hungry Pets** as an online web game.

The documents in this directory are the **source of truth** for implementation. Agents must not rely on memory, assumptions, prior chat context, or external summaries when a rule or technical decision is defined here.

## Authority order

When two documents appear to conflict, use this priority:

1. `02_GAME_RULES.md`
2. `03_CARD_CATALOG.md`
3. `04_GAME_ENGINE_SPEC.md`
4. `05_MULTIPLAYER_ARCHITECTURE.md`
5. `06_UI_UX_SPEC.md`
6. `07_TEST_PLAN.md`
7. `08_IMPLEMENTATION_PLAN.md`
8. `01_PRODUCT_SCOPE.md`

If a genuine contradiction remains, **do not invent a rule**. Record it in `09_OPEN_QUESTIONS.md` and stop only the affected task.

## Core implementation mandate

Build the game as a **server-authoritative, turn-based online web game**.

The first implementation target is the **game engine**, not the final UI.

The engine must be:

- deterministic when supplied with a seeded RNG;
- independent from React, Next.js, NestJS and Socket.IO;
- fully testable without a browser or network;
- explicit about hidden/private information;
- event-driven so the UI can animate game events;
- capable of representing all card interactions and edge cases.

## Default technology decisions

Unless an implementation task explicitly changes them:

- Language: TypeScript
- Frontend: Next.js
- Server: NestJS
- Realtime transport: Socket.IO / WebSocket
- Shared game engine: framework-independent TypeScript package
- Tests: Jest
- Persistent database: PostgreSQL / Neon, introduced only when needed
- Ephemeral room state / scaling: Redis-compatible store, introduced only when needed

## Non-goals for the first release

Do not add these unless a later specification explicitly requests them:

- matchmaking;
- public ranked queues;
- accounts;
- friends;
- cosmetics store;
- payments;
- monetization;
- bots;
- spectator mode;
- chat;
- tournaments;
- achievements;
- progression systems.

## Intellectual-property boundary

This project is intended as a non-commercial adaptation/prototype.

The implementation must keep **game logic** separate from copyrighted visual assets. Development may use placeholders. Original card scans, logos, illustrations, fonts or other protected material must not be assumed to be distributable merely because the project is free.

The software architecture must make it possible to replace all card artwork and branded assets without modifying game logic.

## Agent workflow

Before coding:

1. Read this file.
2. Read `01_PRODUCT_SCOPE.md`.
3. Read `02_GAME_RULES.md`.
4. Read `03_CARD_CATALOG.md`.
5. Read the technical document relevant to the assigned task.
6. Read `09_OPEN_QUESTIONS.md`.

During coding:

- Never implement a rule from memory when it exists in the specification.
- Never leak hidden information to a client.
- Never let a client decide draw results, shuffled order, eliminations, legal targets or card effects.
- Prefer pure functions and explicit state transitions.
- Every rule change must be accompanied by tests.
- Any newly discovered ambiguity must be documented.

## Definition of done for a rules feature

A rule/card feature is done only when:

- its legal preconditions are implemented;
- illegal actions are rejected;
- state transition is correct;
- private/public views are correct;
- resulting domain events are emitted;
- interaction with protection and elimination is covered;
- tests cover the normal path and relevant edge cases.
