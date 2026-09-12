# Card Catalog — Canonical Effects

The deck has 11 card types, values 0 through 10.

Each card instance must have a unique runtime instance ID even when multiple copies share the same value.

---

## 0 — Robot Aspirador Real

**Quantity:** 1

**Timing:** End-of-round passive effect.

**Printed action:** None. Card 0 has no face-up printed action. It is played like any other card and its only rule contribution is the special end-of-round winner evaluation below.

**Rule:**

Card 0's special rule applies only within end-of-round winner evaluation. If a player holds Robot Aspirador Real at the end of the round and another surviving player holds Rey Gato in hand, the Robot holder defeats the Rey Gato holder in their direct pairwise comparison.

This rule is specific to the 0-vs-10 relationship.

It does **not** make value 0 globally higher than values 1–9.

### Required implementation interpretation

At end-of-round evaluation:

- the Robot holder wins the direct pairwise comparison against a Rey Gato holder;
- the Robot loses normally to every other higher card value;
- the Rey Gato holder still beats every non-Robot hand in a direct comparison.

If an ambiguity arises involving multiple remaining players, resolve only the explicit Robot-vs-Rey relationship specially; all unrelated hand values continue to use normal winner logic.

---

## 1 — Pecera de Cristal

**Quantity:** 5

**Effect type:** Target + secret guess.

**Rule:**

Choose another legal active player.

Secretly guess the numeric value of the card in that player's hand.

You **may not guess value 1**.

- If the guess is correct, that player is eliminated.
- If the guess is incorrect, nothing else happens.
- The target does not reveal the card when the guess is wrong.

### Legal targets

- another active player;
- not protected;
- not self.

If no legal target exists, the card is still played and has no targeting effect.

### Information

The guess becomes public only if the UI design chooses to announce it; the target's actual hand remains private unless elimination or another rule reveals it.

---

## 2 — Ratón Trampero

**Quantity:** 3

**Effect type:** Secret draw-pile inspection/reordering.

**Rule:**

1. Secretly take the top card of the draw pile.
2. View it.
3. Reinsert that same card anywhere in the draw pile.
4. The reinsertion position is chosen secretly.

The card does not enter the player's hand.

The player does not publicly reveal the inspected card.

### Empty draw pile edge handling

If the main draw pile is empty when Ratón Trampero is played, there is no top card to inspect. The effect does nothing: no insertion decision is requested, the hidden card is not used and remains untouched, and normal draw-pile exhaustion resolution follows.

### Required UI interaction

The acting player receives a private interface that:

- displays the inspected card;
- allows a legal insertion position to be chosen;
- does not reveal either fact to other clients.

---

## 3 — Conejito Guerrillero

**Quantity:** 3

**Effect type:** Target + private hand comparison.

**Rule:**

Choose another legal active player.

Compare the card remaining in your hand with the card in that player's hand.

- Lower value is eliminated.
- If both values are equal, neither player is eliminated.

The compared values are not publicly revealed by the comparison itself.

If no legal target exists, the card is still played and has no targeting effect.

### Legal targets

- another active player;
- not protected;
- not self.

---

## 4 — Caparazón Armazón

**Quantity:** 2

**Effect type:** Self-protection.

**Rule:**

The acting player becomes protected until the beginning of that player's next turn.

While protected, no other player may directly:

- steal the protected player's hand card;
- view it;
- compare against it;
- exchange it;
- force it to be played;
- otherwise perform a card action on that hand.

Protection is removed at the beginning of the protected player's next turn.

---

## 5 — Serpiente Encantadora

**Quantity:** 2

**Effect type:** Target + forced face-up play.

**Rule:**

Choose another legal active player.

That player must place the card currently in their hand face up in front of them.

**The printed action of that forced card is not resolved.**

If the forced card itself has a face-up trigger independent from its printed action, that trigger still applies.

Then, if the forced player remains active, that player immediately draws a replacement card.

### Rey Gato interaction

If the forced player has Rey Gato:

1. Rey Gato is placed face up.
2. Its face-up condition eliminates that player immediately.
3. The player does not draw a replacement because they are eliminated.

### Legal targets

- another active player;
- not protected;
- not self.

If no legal target exists, no hand is forced face up and no replacement draw occurs; the card is still played and has no targeting effect.

---

## 6 — Saqueadog de Tumbas

**Quantity:** 1

**Effect type:** Hidden-card inspection and optional exchange.

**Rule:**

1. Secretly view the hidden face-down card removed at round setup.
2. Decide whether to exchange that hidden card with the card remaining in your hand.
3. If exchanging:
   - your current hand card becomes the new hidden card;
   - the previously hidden card becomes your hand card.
4. Neither card is publicly revealed.

The decision is private.

---

## 7 — Malabarista de Ocho Patas

**Quantity:** 1

**Effect type:** Active-hand reset.

**Rule:**

1. Every active player returns the card in their hand to the draw pile.
2. Eliminated players do nothing.
3. The played Malabarista card remains face up in the acting player's discard pile.
4. Shuffle the draw pile.
5. Deal one new hand card to every active player.

The hidden card is not included.

Cards already discarded face up are not included.

### Required edge handling

If the number of cards available after returning active hands is exactly the number of active players, deal all of them and leave the draw pile empty.

---

## 8 — Ermitaño Busca Casa

**Quantity:** 1

**Effect type:** Target + hand exchange.

**Rule:**

Choose another legal active player.

Exchange the card remaining in your hand with the card in that player's hand.

Neither card is revealed publicly.

### Legal targets

- another active player;
- not protected;
- not self.

If no legal target exists, the card is still played and the exchange does not happen.

---

## 9 — ¡No soy una mascota!

**Quantity:** 1

**Effect type:** Conditional search + forced exchange.

**Rule:**

If another active player has Rey Gato in hand, that player must exchange Rey Gato with the card remaining in the acting player's hand.

If no other eligible active player has Rey Gato, this card has no additional effect.

If the Rey Gato holder is protected, their hand cannot be manipulated and the effect does not exchange that protected card.

If the acting player already has Rey Gato after playing 9, there is no other Rey Gato holder to exchange with.

### Information

The game server may identify the Rey Gato holder internally.

The client must not expose unrelated players' private hand values.

---

## 10 — Rey Gato

**Quantity:** 1

**Effect type:** Face-up elimination trigger.

**Rule:**

If, for any reason, Rey Gato is placed face up in front of its holder, that player is immediately eliminated.

This applies regardless of whether Rey Gato became face up because:

- it was voluntarily played during a normal turn;
- Serpiente Encantadora forced it to be played;
- the holder was eliminated by another effect and had to reveal the hand;
- another valid rule caused it to be placed face up.

The Rey Gato has no separate active action to resolve after being placed face up.

---

# Targetability Matrix

`✓` = normally valid if target is active and not protected.

| Card | Targets another player? | Blocked by protection? |
|---|---:|---:|
| 0 Robot | No | N/A |
| 1 Pecera | ✓ | ✓ |
| 2 Ratón | No | N/A |
| 3 Conejito | ✓ | ✓ |
| 4 Caparazón | Self | N/A |
| 5 Serpiente | ✓ | ✓ |
| 6 Saqueadog | No | N/A |
| 7 Malabarista | Global reset | Does not target protected hands as an opponent action; all active hands are returned by the global rule |
| 8 Ermitaño | ✓ | ✓ |
| 9 No soy una mascota | Conditional Rey holder | ✓ |
| 10 Rey Gato | No target | N/A |

# Important timing distinction

A **printed action** and an **intrinsic state trigger** are different concepts.

Example:

- Serpiente 5 says the forced card's printed action is not resolved.
- Rey Gato 10 still eliminates its holder because "being face up in front of its holder" is an intrinsic trigger, not an optional printed action being executed.
