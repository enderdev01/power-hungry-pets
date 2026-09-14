# Card System

## Purpose

Define one reusable card system for:

- own hand;
- opponent card backs;
- public discards;
- revealed cards;
- result screens;
- private-decision modals.

## Canonical aspect ratio

Use **63:88**.

Preserve this ratio across all responsive sizes.

## Card anatomy

```text
┌──────────────────────────┐
│ VALUE        CARD TITLE  │
│                          │
│        ARTWORK           │
│                          │
│ EFFECT / SHORT RULE      │
└──────────────────────────┘
```

Required information:

- numeric value;
- card name;
- artwork/placeholder;
- readable effect summary where size permits.

## Suggested size tiers

- Hero/inspect: 260–320px wide
- Desktop own hand: 170–190px
- Tablet own hand: 150–170px
- Mobile own hand: 125–150px
- Public discard/seat card: 80–110px

Responsive `clamp()` values are preferred.

## Card back

The back must:

- be visually distinct from every front;
- work at small scale;
- expose no identity;
- preserve the same aspect ratio;
- use original art.

## Card states

### Normal
Default readable state.

### Hover
Desktop only: subtle elevation, scale, and shadow.

### Focused
Strong keyboard-visible outline.

### Selected
Persistent lift/highlight.

### Playable
Subtle emphasis indicating legal choice.

### Disabled
Reduced emphasis without harming readability.

### Forced play
Must look different from voluntary selection.

### Revealed by elimination
Uses the same public card component, optionally annotated by context.

## Public vs private identity

- Own hand identity: private to owner.
- Opponent hand: card back only.
- Public discard/reveal: full face.
- Private modal card identity: visible only to the authorized player.

## Placeholder art

Until final art is authorized:

- CSS placeholders;
- simple icons/shapes;
- abstract silhouettes;
- internal `artKey` mapping.

Do not hardcode artwork URLs into gameplay logic.

## Asset contract

```ts
interface CardVisualDefinition {
  type: CardType;
  artKey: string;
  frameKey?: string;
  accentKey?: string;
}
```

Artwork must be replaceable without modifying game rules.

## Readability

At small sizes:

- numeric value is always visible;
- title may truncate carefully;
- effect text may move to inspect/details;
- card identity must remain obvious.

## Hand composition

For 1 card: center it strongly.

For 2-card decisions: show both at similar prominence, with enough separation for touch.

Avoid extreme overlap on mobile.

## Shadows

Use soft layered shadows.

Avoid hard black shadows or permanent neon glow.

## Rule boundary

Card visuals never determine legality.

The UI receives legality from authoritative state, e.g.:

```ts
playable: boolean
selected: boolean
disabled: boolean
```

The component must not infer rules from card value/type.
