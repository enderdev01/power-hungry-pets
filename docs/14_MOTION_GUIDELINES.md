# Motion Guidelines

## Purpose

Motion explains state. It must never determine legality or outcome.

Every gameplay animation corresponds to an already-authorized server event/state.

## Priority

High:
- draw;
- play;
- reveal/flip;
- forced play;
- hand swap;
- elimination;
- victory token award.

Medium:
- protection;
- turn indicator;
- target emphasis;
- shuffle.

Low:
- ambient particles;
- decorative glow;
- avatar idle motion.

Low-priority motion must never distract from gameplay.

## Recommended timing

- micro feedback: 120–180ms
- card select/lift: 140–220ms
- draw/play travel: 240–420ms
- flip/reveal: 220–360ms
- swap: 320–520ms
- elimination: 400–700ms
- round-win emphasis: 600–1000ms

Avoid long unskippable sequences.

## Easing

Prefer:

- ease-out for arrival;
- ease-in-out for swaps;
- controlled spring only when useful.

Avoid bouncy motion on every action.

## Draw

Local player:
1. top card lifts;
2. moves toward hand;
3. identity reveals only when authorized;
4. settles into layout.

Opponent draw:
- animate card back only.

## Play

1. selected card lifts;
2. moves toward action/discard area;
3. becomes public;
4. effect cue begins;
5. authoritative layout settles.

## Flip/reveal

Use only for information the viewer is authorized to see.

## Forced play

Visually distinguish from voluntary play.

Suggested:
- card pulled from target seat;
- brief forced-action marker;
- no voluntary-selection cue.

## Swap

Animate generic/authorized card surfaces crossing.

Exact private identities remain visible only to entitled clients.

## Shuffle

For Malabarista:

- active hands converge;
- shuffle cue;
- new hands redeal.

Never expose private identities during the sequence.

## Protection

Activation: brief shield appearance/pulse.

Persistent: static indicator.

Expiry: short fade.

## Elimination

- seat dims;
- hand card reveals publicly;
- eliminated badge appears.

Do not hold the table hostage with a long animation.

## Victory token

Token may pop/move toward the winner's score.

Multiple winners should not require lengthy serial animation.

## Current turn

Use soft pulse/ribbon/arrow/halo.

Avoid constant high-intensity motion.

## Event/projection sequencing

Consume animation cues only after the matching authoritative projection arrives.

If event and projection disagree:

- render projection;
- suppress stale animation.

## Reconnection

Do not replay historical animations.

Render current state, optionally with one subtle reconnect transition.

## Reduced motion

When `prefers-reduced-motion: reduce`:

- replace travel with fades;
- use instant state changes;
- retain all information;
- avoid spatial animation.

## Performance

Prefer transform and opacity.

Avoid layout thrashing.

Target smooth motion on mid-range mobile devices.

## Ownership

Motion belongs in UI/presentation layers.

The engine has no animation timing.

Socket transport has no animation behavior.

## Acceptance criteria

Motion is acceptable only if it:

- corresponds to authoritative state;
- leaks no hidden information;
- survives reconnect/resync;
- supports reduced motion;
- does not block interaction unnecessarily;
- remains smooth on mobile.
