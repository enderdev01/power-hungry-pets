# Product Scope

## Product

A browser-based online adaptation of **Power Hungry Pets**, designed to preserve the feel of the physical card game while making multiplayer play convenient on desktop and mobile.

## Product goals

The game should:

- support 2–6 players;
- allow private rooms using a short room code or invite link;
- require no account for the MVP;
- reproduce the physical rules faithfully;
- provide clear, polished card animations;
- preserve hidden information correctly;
- support disconnections and reconnects without corrupting the match;
- work well on modern desktop and mobile browsers;
- separate visual presentation from rules logic.

## MVP player journey

1. Player opens the website.
2. Player chooses a display name.
3. Player creates a room or joins by code/link.
4. Lobby shows connected players.
5. Host starts when there are 2–6 players.
6. The server creates and shuffles the deck.
7. A round is played according to the official rules encoded in the specs.
8. Round winner(s) receive victory token(s).
9. New rounds continue until the victory threshold is reached.
10. Match winner(s) are displayed.
11. Players can request a rematch.

## Room requirements

MVP rooms are:

- private by default;
- identified by a short code;
- limited to 6 players;
- server authoritative;
- temporary;
- removed after an inactivity timeout.

No account is required to create or join a room.

## Victory threshold

- 2–3 players: first player to reach **3 victory tokens** wins.
- 4–6 players: first player to reach **2 victory tokens** wins.

If multiple players cross the required threshold in the same round because the round itself has multiple winners, the digital adaptation treats the result as a **shared match victory**.

This is a project-level resolution for a case not otherwise specified in the supplied physical rules.

## Platform direction

### Selected platform

**Web application**, not Unity, for the first implementation.

Rationale:

- instant access through a link;
- desktop and mobile compatibility;
- low friction for private multiplayer;
- 2D card animation is sufficient;
- simpler deployment and iteration;
- no installer required.

Unity is not part of the MVP.

## Visual objective

The target is not “a form with cards.”

The game should feel like a polished digital tabletop card game:

- cards move from deck to hand;
- card reveals use flips;
- played cards move to a visible discard area;
- targets are visually highlighted;
- elimination is obvious but not overly disruptive;
- protection has a persistent visual indicator;
- secret information is shown only to the correct player;
- animations never change the underlying rules timing.

## Responsiveness

The game must support:

- desktop;
- tablet;
- mobile portrait;
- mobile landscape where practical.

The information hierarchy must remain usable without hover.

## Accessibility baseline

At minimum:

- do not rely on color alone;
- all actionable cards/buttons must have text or accessible labels;
- animations should respect reduced-motion preferences where practical;
- card values must remain clearly readable;
- mobile touch targets must be sufficiently large.

## Out of scope for MVP

- user accounts;
- player profiles;
- ranked matchmaking;
- public lobby browser;
- voice chat;
- text chat;
- bots;
- AI opponents;
- spectators;
- tournaments;
- progression;
- achievements;
- card collection systems;
- monetization.
