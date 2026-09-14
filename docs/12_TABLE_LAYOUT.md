# Table Layout

## Purpose

Define the spatial composition of the game scene.

The layout should feel like a digital tabletop with players around a shared surface.

## Desktop composition

```text
        [ Opponent Seat ]

[Opponent]            [Opponent]

        [ Action Stage ]
     [Deck] [Discard]
      [Hidden indicator]

[Opponent]            [Opponent]

       [ Local Player ]
          [Hand]
```

Seat count adapts from 2–6 players.

## Table shape

Prefer:

- rounded oval or rounded rectangle;
- slight perspective feel;
- strong separation from the environment;
- enough central negative space for actions.

Avoid a flat full-screen rectangle with no table boundary.

## Table texture

Preferred:

- stylized felt;
- smooth game mat;
- subtle paper/fabric hybrid.

Texture must be low-contrast, seamless, and non-noisy.

## Table color

Use a medium-to-dark base so colorful cards dominate.

Possible directions:

- deep teal;
- muted blue-green;
- warm charcoal-green;
- deep desaturated cyan.

Do not copy branded UNO table art.

## Central action stage

Center hosts:

- draw pile;
- action/discard stage;
- hidden-card indicator;
- temporary reveal/action feedback.

Keep it visually strong but uncluttered.

## Draw pile

Show card-back stack, remaining thickness/count, and no identities.

## Hidden card

Show one face-down card or semantic indicator.

Identity remains private except during authorized effects.

## Opponent seats

Each seat may show:

- avatar;
- name;
- victory tokens;
- connection state;
- protection;
- elimination;
- public discards;
- card-back/hand indicator.

Keep seats compact.

## Local player zone

Anchor to the bottom.

Prioritize:

- own hand;
- current action;
- easy reach/touch;
- high readability.

## Legal target mode

- emphasize legal targets;
- dim non-targets slightly;
- protected/eliminated remain visible but unavailable;
- keep the action instruction visible.

## Mobile priority

1. own hand;
2. current action;
3. target selection;
4. deck/action stage;
5. opponent state;
6. secondary public history.

Opponents may compress into an upper arc/list.

## 320px floor

At 320px:

- reduce opponent metadata;
- preserve card values;
- preserve own-hand interaction;
- avoid horizontal scrolling;
- keep all legal targets accessible.

## Tablet

Do not just scale desktop.

Use larger touch targets, tighter opponent seats, and strong center/hand emphasis.

## Environment

Decorative scenery may surround the table, but never mask controls and must tolerate cropping.

## Z-index order

1. environment
2. table
3. seats
4. deck/discard/hidden
5. cards/action cues
6. HUD
7. private modal
8. system/error overlays

Avoid arbitrary scattered z-index values.

## Reconnection

On reconnect:

- render authoritative state immediately;
- do not require historical animation replay;
- restore hand/seat/table state exactly;
- do not replay stale action cues.
