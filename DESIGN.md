---
name: Power Hungry Pets
description: A private online card table staged as a dark community noticeboard — paper slips, enamel pins, and color reserved for status.
colors:
  noticeboard-green: '#17332d'
  paper: '#f2e7cf'
  paper-ink: '#22312c'
  paper-faded: '#5c6a5f'
  paper-raised: '#fffaf0'
  coral: '#e05a3f'
  coral-ink: '#a3341f'
  enamel-yellow: '#f1b94b'
typography:
  display:
    fontFamily: "'SFMono-Regular', Menlo, Consolas, monospace"
    fontSize: '2.4rem'
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: '0.35em'
  headline:
    fontFamily: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif"
    fontSize: '1.4rem'
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: '0.22em'
  title:
    fontFamily: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif"
    fontSize: '1.35rem'
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: '0.08em'
  body:
    fontFamily: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif"
    fontSize: '1rem'
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 'normal'
  hint:
    fontFamily: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif"
    fontSize: '0.95rem'
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: '0.03em'
  label:
    fontFamily: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif"
    fontSize: '0.8rem'
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: '0.18em'
  tag:
    fontFamily: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif"
    fontSize: '0.72rem'
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: '0.14em'
rounded:
  none: '0'
  sm: '2px'
  pin: '50%'
spacing:
  2xs: '0.35rem'
  xs: '0.55rem'
  sm: '0.75rem'
  md: '1.1rem'
  lg: '1.75rem'
  xl: '2.5rem'
  2xl: '4rem'
components:
  slip:
    backgroundColor: '{colors.paper}'
    textColor: '{colors.paper-ink}'
    rounded: '{rounded.none}'
    padding: '1.5rem 1.75rem 1.6rem'
  pin:
    backgroundColor: '{colors.noticeboard-green}'
    rounded: '{rounded.pin}'
    width: '0.8rem'
    height: '0.8rem'
  pin-error:
    backgroundColor: '{colors.coral}'
    rounded: '{rounded.pin}'
    width: '0.8rem'
    height: '0.8rem'
  action-button:
    backgroundColor: '{colors.paper}'
    textColor: '{colors.paper-ink}'
    rounded: '{rounded.sm}'
    padding: '0.55rem 1.3rem'
  action-button-hover:
    backgroundColor: '{colors.paper-raised}'
  field-input:
    backgroundColor: '{colors.paper-raised}'
    textColor: '{colors.paper-ink}'
    rounded: '{rounded.sm}'
    padding: '0.4rem 0.7rem'
  field-label:
    typography: '{typography.label}'
    textColor: '{colors.paper-ink}'
  room-code:
    typography: '{typography.display}'
    textColor: '{colors.paper-ink}'
  host-tag:
    backgroundColor: '{colors.paper-ink}'
    textColor: '{colors.paper}'
    rounded: '{rounded.sm}'
  presence:
    textColor: '{colors.paper-ink}'
    rounded: '{rounded.sm}'
  presence-away:
    textColor: '{colors.coral-ink}'
    rounded: '{rounded.sm}'
---

# Design System: Power Hungry Pets

## Overview

**Creative North Star: "Cartelera de la partida"**

The interface is a dark community noticeboard. Every screen is a cork-green wall; every piece of content is a printed paper slip pinned to it with an enamel pin. A room begins as one large, slightly tilted invitation slip — the player's name, the room code, the actions — and guests arrive as further name slips gathering around it in real time. Nothing is a floating panel: content is physically attached to the board, the way a convocation flyer is attached to a neighborhood corkboard.

The system is deliberately printed and tactile. Forms are printed-paper forms: heavy small-caps labels stamped above ruled fields, flat ink-bordered buttons, monospaced room codes set like hand-stamped serials. Depth comes from physical affordances — a tilted slip, a pin head, a lighter paper field — never from glow, glass, or shadow. Color is scarce on purpose: the board is dark, the paper is warm, and the only saturated hues (coral, enamel yellow) are reserved for status, connection, and focus.

Every interaction answers textually and immediately: buttons rename themselves while busy ("Pinning the room…"), copy outcomes print a sentence, connection state reads as a line of text with a colored underline. Hover is never load-bearing; the interface must work one-handed on a phone, from a touch target, without any pointer resting on it.

**Key Characteristics:**

- Dark cork-green board (#17332d) as the only page ground; cream paper (#f2e7cf) as the content voice.
- Flat bordered paper slips with enamel pins; no gradients, no glass, no equal-card grids.
- Coral (#e05a3f) and enamel yellow (#f1b94b) reserved for error/connection/focus/selection — never decoration.
- Heavy uppercase labels with wide tracking; monospace only for room codes.
- Depth by pin and tilt (±0.7°), not shadow; focus is the only box-shadow on the page.
- Textual confirmation for every action; hover is never required.
- 3rem minimum interactive height; slips destack and untilt under `prefers-reduced-motion`.

## Colors

The palette is a closed set of eight: one dark ground, four paper tints, and two saturated status hues with one derived accessible ink. Cream paper on dark cork green does almost all the work; the saturated colors appear only where state must be seen.

### Primary

- **Printed Paper** (`paper`, #f2e7cf): The content voice — every slip, button face, and selection-highlight text. On a dark board it is the brightest mass on screen, which is why it can carry meaning without any accent.

### Secondary

- **Coral** (`coral`, #e05a3f): The status alarm — error slip borders, error pins, disconnected/error connection underlines. Structural, never decorative: if coral is on screen, something needs attention.
- **Coral Ink** (`coral-ink`, #a3341f): Coral darkened for text on paper (5.6:1 on Printed Paper). Used wherever the alarm must be _read_, not just seen: error notices, "away" presence tags.

### Tertiary

- **Enamel Yellow** (`enamel-yellow`, #f1b94b): The pin enamel and the live wire — pin borders, keyboard focus rings, text selection, connected-state underlines. Its job is to say "this exact spot is active."

### Neutral

- **Noticeboard Green** (`noticeboard-green`, #17332d): The page ground and the pin's dark core. Also the fallback color scheme (scrollbars, UA chrome stay on-palette).
- **Paper Ink** (`paper-ink`, #22312c): All text and borders on paper — the printed layer.
- **Faded Ink** (`paper-faded`, #5c6a5f): De-emphasized ink: hints, meta text, dashed dividers and provisional slots on paper.
- **Raised Paper** (`paper-raised`, #fffaf0): The lightest paper tint — ruled fields and hover faces. Derived accessibility role: lifts input fields above the slip so typed text keeps contrast, and signals "pressable" on hover.

### Named Rules

**The Status-Only Color Rule.** Coral and enamel yellow never decorate. They mark error, connection state, keyboard focus, and selection — and nothing else. If a hue appears without a state behind it, it is a defect.

## Typography

**Display Font:** SFMono-Regular / Menlo / Consolas monospace (room codes only)
**Body Font:** Iowan Old Style / Palatino Linotype / Palatino / Georgia serif
**Label Font:** same serif stack, set small, heavy, tracked, and uppercase

**Character:** A bookish, slightly worn serif reads like printed paper — warm, editorial, a bit analog. The monospace exception is the point: room codes are machine-stamped serials, set in the only non-serif voice in the system so they read as codes, not prose.

### Hierarchy

- **Display** (700, 2.4rem, monospace, 0.35em tracking): The room code, and only the room code. The one oversized moment on any screen.
- **Headline** (700, 1.4rem, 0.22em tracking, uppercase): The "POWER HUNGRY PETS" wordmark. Letter-spaced like a printed masthead.
- **Title** (700, 1.35rem, 0.08em tracking, uppercase): Slip titles ("Tonight's invitation"). One per slip, never stacked.
- **Body** (400, 1rem, 1.5 line-height): All sentences, hints at 0.95rem. Slips are narrow enough that no max-width clamp is needed.
- **Label** (700, 0.8rem, 0.18em tracking, uppercase): Field labels and slip section headers — the rubber-stamped layer.
- **Tag** (700, 0.72rem, 0.14em tracking, uppercase): HOST and presence chips.

### Named Rules

**The Rubber-Stamp Label Rule.** Labels are small, bold, widely tracked uppercase set in the same serif as the body — they read as stamped headings, not as a sans-serif UI font dropped in from another world.

## Layout

One centered noticeboard column. The container caps at 64rem with padding 2.5rem top, 1.25rem sides, 4rem bottom — generous top/bottom margins like a board viewed standing. Content is a vertical stack of slips separated by 1.75rem of board; slips keep 1.75rem of breathing room between each other and 1.1rem between fields inside a slip.

On narrow viewports (≤46rem breakpoint, observed in the implementation), any side-by-side slip arrangement stacks into a single column; the stack order preserves reading order rather than rearranging into grids. Interactive targets hold a 3rem minimum height (inputs and buttons; player rows run 2.9rem) so touch never needs precision.

There is no persistent site chrome beyond the masthead: wordmark, one masthead line, then the slips. Whitespace belongs to the board — dark green is allowed to be empty.

## Elevation & Depth

This system is flat by doctrine: no gradients, no glass, no drop shadows. Depth is physical and tonal — a cream slip sits on the dark board, raised paper sits on the slip, and a circular enamel pin appears to push the slip into the cork. The only box-shadow on the entire page is the keyboard focus ring, which is a state treatment, not elevation.

### Named Rules

**The Pin, Not the Shadow Rule.** Depth is expressed by what attaches a slip to the board — the enamel pin and the ±0.7° tilt — never by cast light. Shadows are for focus only.

## Shapes

The form language is paper cut with scissors and pressed with a stamp. Slips are square-cornered rectangles (0 radius) with a 1px ink border — they are sheets, not cards. Interactive elements (inputs, buttons, tags, player rows) get a barely-there 2px radius, a printed affordance rather than a soft UI chip, and a heavier 2px ink border because they must survive touch. Pins are perfect circles (50%, 0.8rem).

Border weight carries meaning: 2px solid = committed/interactive, 1px solid = the paper itself, dashed = provisional (disabled actions, empty player slots, notice separators). Corners never exceed 2px except the pin's circle; nothing is pill-shaped.

## Components

### Slips (signature component)

- **Character:** The one container in the system — every content region on every screen is a slip.
- **Shape:** Square corners (0), 1px solid Paper Ink border, padding 1.5rem 1.75rem 1.6rem.
- **Colors:** Printed Paper background, Paper Ink text.
- **Pin:** 0.8rem circle at top-left (0.55rem inset), Noticeboard Green core with 2px Enamel Yellow rim; the error variant fills Coral with an ink rim.
- **Tilt:** −0.7° at rest, +0.55° on even siblings (roster slips always tilt +0.55°). Removed entirely under `prefers-reduced-motion`.
- **Error variant:** 2px Coral border replaces the 1px ink border; the error sentence is bold.

### Buttons

- **Shape:** 2px radius, 2px solid Paper Ink border, padding 0.55rem 1.3rem, min-height 3rem.
- **Default:** Printed Paper face, Paper Ink text, bold, 0.04em tracking — a printed-paper button, not a filled accent.
- **Hover:** Face lifts to Raised Paper. No shadow, no translate.
- **Disabled:** Border turns dashed, opacity 0.55, cursor not-allowed — "provisional," in the system's border language.
- **Busy:** The label answers textually ("Pinning the room…", "Joining…") instead of adding a spinner treatment.

### Inputs

- **Style:** 2px solid Paper Ink border, 2px radius, Raised Paper field on the slip, ink caret, min-height 3rem, padding 0.4rem 0.7rem.
- **Labels:** Rubber-stamp label layer above each field, always visible.
- **Code variant:** Uppercase-forced, 0.3em tracking, bold — typed room codes look pre-stamped.

### Room code display

- **Style:** Display voice only — 2.4rem bold monospace, 0.35em tracking, Paper Ink on paper. Never used for anything but the code.

### Chips (host / presence)

- **Style:** 2px radius, tag typography (0.72rem, 0.14em tracking, uppercase), 0.15rem × 0.45rem padding.
- **HOST:** Solid Paper Ink fill with paper text — the only inverted chip.
- **Presence:** Outlined in ink on paper; "away" flips to Coral Ink outline and text so absence reads without color-only meaning.

### Connection line

- **Style:** One serif sentence with a 2px bottom rule on the keyword-bearing line: Enamel Yellow when connected, Coral when disconnected or erroring, plain when idle. Always paired with textual wording — the underline confirms, the words inform.

### Notices

- **Style:** A role="log" list inside a slip; entries separated by 1px dashed Faded Ink rules (the system's "provisional" voice). Success notices bold; error notices bold in Coral Ink.

## Do's and Don'ts

### Do:

- **Do** reserve coral (#e05a3f) and enamel yellow (#f1b94b) for error, connection, focus, and selection states — per the Status-Only Color Rule.
- **Do** answer every action textually: busy labels ("Pinning the room…"), status sentences, and connection lines. The board speaks.
- **Do** keep interactive targets at least 3rem tall; hover is never required to reach any state.
- **Do** keep keyboard focus doubly visible: 0 0 0 2px Enamel Yellow ring plus a 3px Paper Ink outline at 2px offset.
- **Do** tilt slips subtly (±0.7° max) and drop all tilt and motion under `prefers-reduced-motion`.
- **Do** use dashed borders for provisional things: disabled actions, empty slots, notice separators.
- **Do** use Coral Ink (#a3341f), not Coral, for any alarm-colored text on paper (5.6:1).

### Don't:

- **Don't** add gradients, glassmorphism, or drop shadows; the board is flat and depth comes from pins and tilt.
- **Don't** invent a ninth color; the palette is closed at eight tokens.
- **Don't** arrange content into equal-card grids of identical tiles; slips differ by role, tilt, and content.
- **Don't** rely on color alone to carry status — every state also has text or a label.
- **Don't** set the monospace voice anywhere except room codes (typed and displayed).
- **Don't** round corners beyond 2px or make pill shapes; paper is cut, not molded.
- **Don't** let animation imply game state; presentation may animate authorized events but never determines them.
