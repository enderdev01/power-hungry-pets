# Game Rules — Source of Truth

## 1. Players

The game supports **2 to 6 players**.

## 2. Deck

The deck contains **21 cards** total.

| Value | Quantity |
|---:|---:|
| 0 | 1 |
| 1 | 5 |
| 2 | 3 |
| 3 | 3 |
| 4 | 2 |
| 5 | 2 |
| 6 | 1 |
| 7 | 1 |
| 8 | 1 |
| 9 | 1 |
| 10 | 1 |

Exact card names and effects are defined in `03_CARD_CATALOG.md`.

## 3. Match victory tokens

There are 7 physical victory tokens in the tabletop game.

Digital scoring uses the following victory thresholds:

- **2–3 players:** 3 tokens to win the match.
- **4–6 players:** 2 tokens to win the match.

The number of physical token objects does not constrain the digital score model.

## 4. Round setup

At the beginning of every round:

1. Reconstruct the complete 21-card deck.
2. Shuffle it.
3. Deal exactly 1 card to every player.
4. Remove exactly 1 card from the deck and place it face down as the **hidden card**.
5. The remaining cards become the draw pile.
6. Every player begins the round active and unprotected.
7. Every player's round discard pile begins empty.
8. Select the first player according to the current match turn-order policy.

The hidden card remains secret unless a card effect explicitly allows it to be viewed.

## 5. Normal turn

At the beginning of a normal turn, the active player normally has exactly 1 card in hand.

The turn sequence is:

1. Draw the top card from the draw pile.
2. The player now normally has 2 cards.
3. Choose one of those cards to play.
4. Place the chosen card face up in that player's discard area.
5. Resolve its effect.
6. Check eliminations.
7. Check whether the round has ended.
8. If the round continues, advance to the next active player.

A player normally ends the turn with exactly 1 card in hand.

## 6. Eliminated players

When a player is eliminated:

1. Mark the player as eliminated for the rest of the round.
2. If the player still has a card in hand, place that card face up in front of the player.
3. Do **not** resolve the printed action of that revealed hand card.
4. The player takes no further turns during the round.
5. Eliminated players cannot be selected as normal targets.

Eliminated players return as active players when the next round begins.

## 7. Protection

A protected player cannot have the card in their hand:

- stolen;
- viewed;
- compared;
- forcibly played;
- exchanged;
- otherwise directly manipulated by another player's card action.

Protection lasts until the beginning of that protected player's next turn.

At the beginning of that player's next turn, protection is removed before normal turn actions continue.

If an effect requires a target, protected players are not legal targets.

If an effect searches for or affects a specific card holder and that holder is protected, the protected hand cannot be manipulated.

## 8. End of round — last survivor

If all players except one have been eliminated, the remaining active player wins the round immediately.

No hand-value comparison is required.

## 9. End of round — draw pile exhausted

When the draw pile can no longer provide the required normal draw, the round ends.

All remaining active players **simultaneously publicly reveal** their one remaining hand card.

The reveal moves no cards: revealed cards stay in their owners' hands. They are **not** placed in the discard piles and are not treated as played cards.

The engine represents the reveal with the `HANDS_REVEALED` event, which is always emitted before `ROUND_ENDED`.

The round winner is then determined by direct pairwise comparison (see §10).

### Last survivor exception

If only one active player remains, that player wins immediately under §8 with **no** hand reveal.

## 10. Round winner — direct pairwise comparison and tie breaker

With two or more active players at the end of a round, every pair of surviving players is compared directly:

- the higher card value wins that pair;
- equal values win the pair for nobody;
- special 0-vs-10 matchup (see `03_CARD_CATALOG.md`): Robot Aspirador Real **beats Rey Gato directly**, while Robot loses normally to every other higher card value and Rey beats every non-Robot card.

Each player's direct pairwise wins are counted. The players with the highest number of pairwise wins are the winner candidates.

### Discard-total tie breaker

If more than one winner candidate remains:

1. Each tied player adds the printed values of all cards in their own face-up discard pile for that round.
2. The tied player with the highest discard total wins the round.
3. If the discard totals are also exactly tied, **all still-tied players win the round**.
4. Each round winner receives 1 victory token.

Only winner candidates participate in the discard-total tie breaker. Players outside the tied group have no influence on the tie break, even if their own discard totals are higher.

## 11. Match end

After victory tokens are awarded:

- with 2–3 players, any player with at least 3 tokens is a match winner;
- with 4–6 players, any player with at least 2 tokens is a match winner.

If multiple players reach the threshold in the same round, the digital game declares all of them joint winners.

## 12. Public discard information

Cards played or revealed face up in front of players are public information.

This includes:

- normally played cards;
- a defeated player's revealed hand;
- cards forcibly played face up;
- any other card explicitly placed face up by the rules.

## 13. Hidden information

The following are private unless a card effect says otherwise:

- each active player's hand card;
- draw-pile order;
- the hidden card;
- a secretly viewed card;
- the secretly selected insertion position used by Ratón Trampero.

The server may know all of this information.

Clients may receive only information they are entitled to know.

## 14. Invalid actions

The game server must reject an action when:

- it is not that player's turn;
- the player is eliminated;
- the selected card is not in that player's hand;
- the selected target is illegal;
- the target is protected;
- the effect requires a guess that is prohibited;
- the game is waiting for another decision;
- the round or match is already complete;
- the action would violate the current interaction state.

Invalid actions must not partially mutate the game state.

### Target-requiring cards with no legal target

When a card that requires a target is played while **no legal target exists**, the play itself is not an invalid action: the card is still placed face up in the acting player's discard area, its targeting effect does nothing, and the turn continues normally.

Selecting an illegal target (self, eliminated, or protected) while at least one legal target exists remains a rejected invalid action.

Self is never a legal target for another-player targeting effects.

## 15. Rule timing principle

Card text takes precedence over the normal turn sequence when it explicitly changes that sequence.

Examples:

- Serpiente Encantadora can force another player's hand card to be played without resolving that card's printed action.
- Rey Gato eliminates its holder whenever it is placed face up in front of that holder, regardless of why it became face up.
- Malabarista de Ocho Patas reconstructs the active players' hands from the draw pile plus returned hand cards according to its effect.
