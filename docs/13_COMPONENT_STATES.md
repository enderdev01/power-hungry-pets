# Component States

## Global states

### Waiting for turn
Subdued own controls; clearly mark current active player.

### Your turn — draw required
Strong turn prompt and deck emphasis.

### Your turn — play required
Show both hand cards and clear selection affordance.

### Pending target selection
Highlight only legal targets while keeping the table visible.

### Pending private decision
Use a blocking accessible modal over a visible but inert table.

## Player seat states

### Normal
Default seat.

### Current turn
Use ring/ribbon/arrow/halo. A subtle pulse is allowed if motion is enabled.

### Protected
Show shield icon + label/state marker until expiry.

### Eliminated
Reduce saturation/opacity, show clear eliminated marker, and keep public revealed card/history visible.

### Disconnected
Show connectivity status. Never equate disconnect with elimination.

### Winner / round winner
Use celebratory badge/border and victory-token feedback without hiding result information.

## Card interaction states

### Selectable
Strong affordance.

### Selected
Persistent until command resolves.

### Submitted / awaiting confirmation
Prevent duplicate submission and show a subtle pending state.

### Rejected
Restore authoritative state, clear stale selection, and show concise typed error feedback.

## Private modals

### Pecera
1. show target context;
2. choose value;
3. value 1 disabled/unavailable;
4. submit;
5. wait for server result.

### Ratón
1. show inspected private card;
2. choose insertion position;
3. submit;
4. close after authoritative resolution.

### Saqueadog
1. show current hand;
2. show hidden card privately;
3. Keep / Swap;
4. submit;
5. close after authoritative resolution.

Mandatory decision modal requirements:

- no Escape close;
- no outside-click cancel;
- focus trap;
- background inert;
- restore focus after resolution;
- mobile-safe.

## Protection feedback

Activation: brief shield cue.

Persistent: static shield/status.

Expiry: subtle removal cue.

## Elimination feedback

Communicate:

- who was eliminated;
- revealed card;
- public elimination state.

Keep the sequence short.

## Round result

Show:

- winner(s);
- winning card/value;
- tie-break totals when used;
- victory token changes.

## Match result

Show:

- winner or joint winners;
- final token counts;
- terminal-state clarity;
- only supported next actions.

Do not show a fake rematch control if rematch is not implemented.

## Errors

Gameplay errors should be concise, mapped from typed codes, and non-destructive.

Never expose server internals.

## Loading

Preserve table context where possible.

Avoid replacing the entire screen with a generic spinner for minor transitions.

## Accessibility

Important states must use at least text/icon/ARIA in addition to color.
