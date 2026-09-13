---
version: 1
slug: 'route-room-code'
primary_target: 'route:/room/[code]'
related_targets:
  ['route:/', 'apps/web/src/components/lobby.tsx', 'apps/web/src/components/home-invitation.tsx']
---

# Surface Brief: Room Flow (invitation + lobby)

Approved visual direction: "Cartelera de la partida" (impeccable seed 9719d81e; decision record `.impeccable/mocks/decision/m7-room-flow.json`, build path: code). Finish review verdict recorded in `.impeccable/review/` (desktop/mobile home and room captures). System-wide rules live in root `DESIGN.md`; this brief owns only this surface's strategy.

## Mode

Operate. The surface is a functional threshold — arrive, be seen, start the match — not a persuasion or browsing surface.

## Strategy

- **One invitation, then the board.** The home viewport is a single large tilted invitation slip (name, create action, join-by-code) plus a textual connection line. After pinning, the room route becomes the noticeboard: room code, roster, host actions, and notices gather as further slips.
- **Slips gather, they don't tile.** Player arrival is expressed as a live, visible change (a new name slip row appears and the roster count updates), never as a static pre-drawn list. Reuse the "arrival is visible" commitment raised from the ascii-live direction.
- **Every event confirms textually at once.** Connection lines, copy-link outcomes, start-gate reasons, and room notices print a sentence the moment the event lands (carried over from the phosphor-terminal direction). Color underlines only confirm what the words already say.
- **Color stays rationed.** Coral and enamel yellow appear only on error slips, connection state, focus, and presence-away; the invitation itself stays paper and ink (carried over from the iridescent-edge direction).
- **First viewport.** Masthead (wordmark + connection line), then the invitation or join slip, then code/roster slips, host actions, notices. On ≤46rem everything stacks in reading order; no reordering.

## Invariants

- The room code is the display-voice moment: 2.4rem monospace, 0.35em tracking, nothing else may use that voice.
- Host start gating reads its block reason as a sentence; the button never silently disables without explanation.
- Rematch is undecided at the server-contract level: this surface must not promise or hint at it.
- The match table is out of scope for this slice: when IN_MATCH, the surface says so textually and adds nothing else.

## Do not literalize

- No cork texture, photographic pins, or skeuomorphic shadows: material is stated through flat color, borders, tilt, and the pin glyph only.
- The tilt is ±0.7°/0.55°, never more; it vanishes under `prefers-reduced-motion`.
- No faux handwritten fonts: the printed serif and stamped labels are the paper's voice.
