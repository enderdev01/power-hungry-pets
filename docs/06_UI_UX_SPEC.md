# UI / UX Specification

## 1. Design goal

Create the feeling of a polished digital card game while preserving the simplicity and readability of the physical game.

The UI must never obscure whose turn it is, what decision is required, or which information is private.

## 2. Primary screens

MVP:

1. Home
2. Create room
3. Join room
4. Lobby
5. Game table
6. Round result
7. Match result

## 3. Lobby

Show:

- room code;
- invite/copy action;
- player list;
- connected/disconnected status;
- host marker;
- start button for host;
- minimum/maximum player feedback.

Do not expose hidden game state before match start.

## 4. Game table hierarchy

The game table should prominently show:

- opponents arranged around the play space;
- current player's own hand at the bottom;
- draw pile;
- hidden-card indicator;
- public discard areas;
- current turn indicator;
- player victory tokens;
- protection markers;
- elimination state.

## 5. Own hand

Normal state:

- 1 card.

After drawing:

- 2 cards;
- player selects which one to play.

Card selection must work by:

- click/tap;
- keyboard where practical.

Hover must not be required.

## 6. Card readability

Every card representation must clearly show:

- numeric value;
- card name;
- artwork;
- effect summary when expanded.

On small mobile screens:

- the hand card may enlarge on tap;
- effect text can use a detail panel;
- the numeric value must remain visible without zoom.

## 7. Core animations

Required high-value animations:

- draw card from deck to hand;
- card flip/reveal;
- play card from hand to discard zone;
- hand exchange;
- forced play;
- protection activation;
- elimination;
- shuffle/reset for Malabarista;
- victory token award.

Animations must visualize an already-authorized server event.

They must not determine game outcome.

## 8. Animation resilience

If a client reconnects or misses an event:

- render latest authoritative state immediately;
- do not require replaying the full animation history.

## 9. Turn feedback

Show a clear state such as:

```text
YOUR TURN
Draw a card
```

or:

```text
Choose a player
```

or:

```text
Guess their card value
```

The prompt must correspond to the server-provided legal interaction.

## 10. Legal targets

When a card requires a target:

- highlight only legal targets;
- protected targets should visually communicate protection;
- eliminated players must not look selectable.

The client should still tolerate server rejection.

## 11. Private interactions

### Pecera

Show target selection, then numeric guess selector.

Disable value 1.

### Ratón

Show inspected card only to actor.

Provide insertion position UI without revealing deck identities.

Possible UX:

```text
Top
[ slot 0 ]
[ slot 1 ]
[ slot 2 ]
...
Bottom
```

Do not show hidden identities of other deck cards.

### Saqueadog

Privately show:

- current hand;
- hidden card;
- Keep / Swap decision.

### Conejito

The client may animate a private comparison without revealing exact opponent value unless rules require it.

## 12. Protection

Protected player needs a persistent visual marker until protection expires.

Avoid visual effects that reveal the protected player's card.

## 13. Elimination

On elimination:

- reveal the eliminated player's remaining hand face up as required;
- mark player clearly as eliminated;
- retain their public discard history;
- remove them from active-turn emphasis.

## 14. Round result

Show:

- winner(s);
- winning hand(s);
- tie-break discard totals if used;
- token awarded to each winner;
- updated match score.

## 15. Match result

Show:

- winner or joint winners;
- final token counts;
- rematch option.

## 16. Responsive behavior

### Desktop

Table-oriented layout with all opponents visible.

### Mobile

Prioritize:

1. own hand;
2. current action;
3. current turn;
4. deck;
5. active target selection.

Opponent zones may compress but must remain tappable.

## 17. Motion accessibility

Respect reduced-motion preferences where practical.

Reduced motion should:

- shorten travel animations;
- replace complex movement with fades/state changes;
- keep all gameplay information intact.

## 18. Asset separation

Card definitions should reference asset keys rather than hard-coded branded images.

Example:

```ts
{
  type: "PECERA_CRISTAL",
  artKey: "card-1"
}
```

This allows art replacement without modifying game rules.

## 19. Audio

Audio is optional for MVP.

If added:

- draw;
- play;
- shuffle;
- protection;
- elimination;
- round win

should be subtle and individually mutable.

No gameplay state may depend on audio.
