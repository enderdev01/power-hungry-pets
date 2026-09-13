# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Groups of 2–6 people who already want to play Power Hungry Pets together in a private online room, typically from modern desktop or mobile browsers. They need to enter quickly, identify one another, and complete a match without creating accounts.

## Product Purpose

Provide a browser-based online adaptation of Power Hungry Pets that preserves the physical game's rules, hidden information, and social table experience while removing setup and location friction. Success means a private group can create or join a room and complete an authoritative online match from desktop or mobile.

## Positioning

The product combines a faithful, deterministic implementation of the supplied physical rules with server-authoritative multiplayer and viewer-specific private projections, so convenience does not compromise hidden information or rules integrity.

## Operating Context

Players open an invite link or enter a short room code, choose a display name, gather in a temporary private lobby, and play rounds until the configured victory threshold is reached. No account is required. The interface must remain usable without hover and must recover from ordinary disconnects by rendering the latest authoritative state.

## Capabilities and Constraints

- Support 2–6 players in private rooms.
- Use Next.js for the web client, NestJS and Socket.IO for multiplayer, and the framework-independent TypeScript game engine for rules.
- Keep the server authoritative for legal actions, deck order, hidden information, eliminations, targeting, and outcomes.
- Keep rule logic out of React components and presentation concerns out of the game engine.
- Preserve public/private projection boundaries; never expose another player's hand or reconnect token.
- Keep card artwork and branded assets replaceable without changing game logic.
- Use placeholders rather than assuming copyrighted physical-game assets are distributable.
- Exclude accounts, matchmaking, public lobbies, chat, bots, spectators, progression, tournaments, and monetization from the MVP.
- Rematch remains undecided at the server-contract level and must not be promised by the Milestone 7 interface.

## Brand Commitments

- Product name: Power Hungry Pets.
- Preserve the feeling of a social tabletop card game rather than presenting a generic form-driven application.
- The implementation is a non-commercial adaptation/prototype and must respect the repository's intellectual-property boundary.

## Evidence on Hand

- Product and platform requirements: `docs/01_PRODUCT_SCOPE.md`.
- Rules and card definitions: `docs/02_GAME_RULES.md`, `docs/03_CARD_CATALOG.md`.
- Authoritative technical contracts: `docs/04_GAME_ENGINE_SPEC.md`, `docs/05_MULTIPLAYER_ARCHITECTURE.md`.
- Interaction and accessibility requirements: `docs/06_UI_UX_SPEC.md`.
- Milestone and test expectations: `docs/07_TEST_PLAN.md`, `docs/08_IMPLEMENTATION_PLAN.md`.
- No approved distributable card artwork, logo set, custom font, testimonials, commercial claims, or production deployment evidence is currently recorded.

## Product Principles

1. Rules and hidden information remain authoritative even when presentation degrades.
2. Players should always understand whose turn it is and what decision is required.
3. Entering a private game should require minimal ceremony and no account.
4. Desktop and mobile are first-class play contexts; hover is never required.
5. Visual presentation may animate authorized events but never determine game state.

## Accessibility & Inclusion

Do not rely on color alone. All actions require text or accessible labels, card values must remain readable, mobile targets must be sufficiently large, and gameplay information must remain intact when reduced motion is enabled.
