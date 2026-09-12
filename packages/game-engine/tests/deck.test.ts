import { CARD_CATALOG, SeededRng, createDeck, shuffleDeck } from '../src';

describe('canonical deck', () => {
  it('contains the exact 21-card catalog with unique instances', () => {
    const deck = createDeck();
    const quantities = new Map<number, number>();

    for (const card of deck) {
      quantities.set(card.value, (quantities.get(card.value) ?? 0) + 1);
    }

    expect(deck).toHaveLength(21);
    expect(new Set(deck.map((card) => card.instanceId)).size).toBe(21);
    expect(quantities).toEqual(
      new Map([
        [0, 1],
        [1, 5],
        [2, 3],
        [3, 3],
        [4, 2],
        [5, 2],
        [6, 1],
        [7, 1],
        [8, 1],
        [9, 1],
        [10, 1],
      ]),
    );
    expect(deck.filter((card) => card.type === 'REY_GATO')).toHaveLength(1);
    expect(CARD_CATALOG).toHaveLength(11);
  });

  it('shuffles deterministically with a seeded RNG without mutating the input deck', () => {
    const deck = createDeck();
    const firstShuffle = shuffleDeck(deck, new SeededRng(12345));
    const repeatedShuffle = shuffleDeck(deck, new SeededRng(12345));
    const distinctShuffle = shuffleDeck(deck, new SeededRng(54321));

    expect(firstShuffle.map((card) => card.instanceId)).toEqual(
      repeatedShuffle.map((card) => card.instanceId),
    );
    expect(firstShuffle.map((card) => card.instanceId)).not.toEqual(
      distinctShuffle.map((card) => card.instanceId),
    );
    expect(deck.map((card) => card.instanceId)).toEqual(
      createDeck().map((card) => card.instanceId),
    );
  });
});
