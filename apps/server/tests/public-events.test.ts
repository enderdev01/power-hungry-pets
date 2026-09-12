/**
 * Public event sanitizer (Milestone 6 server work unit 3).
 *
 * Normative design under test:
 * - Accepts engine `TurnEvent` / `MatchRulesEvent` batches and returns fresh,
 *   JSON-safe public event objects in order.
 * - Strips `CardInstance.instanceId` from `CARD_PLAYED`, `CARD_FORCED_FACE_UP`,
 *   and `HANDS_REVEALED`, preserving only the documented public fields
 *   (value/type for cards).
 * - Never carries command, guess, insertion index, swap choice, or any private
 *   card data; runtime extra fields on inputs are dropped.
 * - Exhaustive fail-closed mapping: any unknown future event variant throws a
 *   typed `PublicEventError` instead of leaking an unsafe shape.
 */
import type { CardInstance, MatchRulesEvent, TurnEvent } from '@power-hungry-pets/game-engine';
import {
  PublicEventError,
  PublicEventErrorCode,
  sanitizePublicEvents,
} from '../src/projection/public-events';

const PLAYED_CARD: CardInstance = {
  instanceId: 'card-7-1',
  value: 7,
  type: 'MALABARISTA_DE_OCHO_PATAS',
};

const FORCED_CARD: CardInstance = {
  instanceId: 'card-5-1',
  value: 5,
  type: 'SERPIENTE_ENCANTADORA',
};

interface VariantFixture {
  readonly name: string;
  readonly input: TurnEvent | MatchRulesEvent;
  readonly expected: Record<string, unknown>;
}

const VARIANTS: readonly VariantFixture[] = [
  {
    name: 'CARD_DRAWN',
    input: { type: 'CARD_DRAWN', playerId: 'p1' },
    expected: { type: 'CARD_DRAWN', playerId: 'p1' },
  },
  {
    name: 'CARD_PLAYED',
    input: { type: 'CARD_PLAYED', playerId: 'p1', card: PLAYED_CARD },
    expected: {
      type: 'CARD_PLAYED',
      playerId: 'p1',
      card: { value: 7, type: 'MALABARISTA_DE_OCHO_PATAS' },
    },
  },
  {
    name: 'PECERA_GUESS_RESOLVED',
    input: { type: 'PECERA_GUESS_RESOLVED', actorId: 'p1', targetId: 'p2', correct: false },
    expected: { type: 'PECERA_GUESS_RESOLVED', actorId: 'p1', targetId: 'p2', correct: false },
  },
  {
    name: 'SAQUEADOG_RESOLVED',
    input: { type: 'SAQUEADOG_RESOLVED', playerId: 'p3' },
    expected: { type: 'SAQUEADOG_RESOLVED', playerId: 'p3' },
  },
  {
    name: 'RATON_RESOLVED',
    input: { type: 'RATON_RESOLVED', playerId: 'p2' },
    expected: { type: 'RATON_RESOLVED', playerId: 'p2' },
  },
  {
    name: 'PROTECTION_EXPIRED',
    input: { type: 'PROTECTION_EXPIRED', playerId: 'p1' },
    expected: { type: 'PROTECTION_EXPIRED', playerId: 'p1' },
  },
  {
    name: 'HANDS_SWAPPED',
    input: { type: 'HANDS_SWAPPED', playerIds: ['p1', 'p2'] },
    expected: { type: 'HANDS_SWAPPED', playerIds: ['p1', 'p2'] },
  },
  {
    name: 'HANDS_REDEALT',
    input: { type: 'HANDS_REDEALT', playerIds: ['p1', 'p2', 'p3'] },
    expected: { type: 'HANDS_REDEALT', playerIds: ['p1', 'p2', 'p3'] },
  },
  {
    name: 'CARD_FORCED_FACE_UP',
    input: { type: 'CARD_FORCED_FACE_UP', playerId: 'p2', card: FORCED_CARD },
    expected: {
      type: 'CARD_FORCED_FACE_UP',
      playerId: 'p2',
      card: { value: 5, type: 'SERPIENTE_ENCANTADORA' },
    },
  },
  {
    name: 'PLAYER_PROTECTED',
    input: { type: 'PLAYER_PROTECTED', playerId: 'p2' },
    expected: { type: 'PLAYER_PROTECTED', playerId: 'p2' },
  },
  {
    name: 'PLAYER_ELIMINATED',
    input: { type: 'PLAYER_ELIMINATED', playerId: 'p2' },
    expected: { type: 'PLAYER_ELIMINATED', playerId: 'p2' },
  },
  {
    name: 'HANDS_REVEALED',
    input: {
      type: 'HANDS_REVEALED',
      hands: [
        { playerId: 'p1', card: PLAYED_CARD },
        {
          playerId: 'p3',
          card: { instanceId: 'card-0-1', value: 0, type: 'ROBOT_ASPIRADOR_REAL' },
        },
      ],
    },
    expected: {
      type: 'HANDS_REVEALED',
      hands: [
        { playerId: 'p1', card: { value: 7, type: 'MALABARISTA_DE_OCHO_PATAS' } },
        { playerId: 'p3', card: { value: 0, type: 'ROBOT_ASPIRADOR_REAL' } },
      ],
    },
  },
  {
    name: 'ROUND_ENDED',
    input: { type: 'ROUND_ENDED', winnerIds: ['p2'] },
    expected: { type: 'ROUND_ENDED', winnerIds: ['p2'] },
  },
  {
    name: 'TOKEN_AWARDED',
    input: { type: 'TOKEN_AWARDED', playerId: 'p2' },
    expected: { type: 'TOKEN_AWARDED', playerId: 'p2' },
  },
  {
    name: 'MATCH_ENDED',
    input: { type: 'MATCH_ENDED', winnerIds: ['p2', 'p3'] },
    expected: { type: 'MATCH_ENDED', winnerIds: ['p2', 'p3'] },
  },
];

/** Deep copy of JSON-safe event data (repo convention: JSON round-trip). */
function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('sanitizePublicEvents — exhaustive variant mapping', () => {
  for (const variant of VARIANTS) {
    it(`maps ${variant.name} to exactly its documented public shape`, () => {
      const output = sanitizePublicEvents([variant.input]);

      expect(output).toHaveLength(1);
      expect(output[0]).toStrictEqual(variant.expected);
    });

    it(`maps ${variant.name} to a JSON-safe object with no instanceId anywhere`, () => {
      const output = sanitizePublicEvents([variant.input]);
      const serialized = JSON.stringify(output);

      expect(() => JSON.parse(serialized)).not.toThrow();
      expect(serialized).not.toContain('instanceId');
      expect(JSON.parse(serialized)).toEqual(output);
    });
  }
});

describe('sanitizePublicEvents — batching and ordering', () => {
  it('sanitizes a mixed TurnEvent + MatchRulesEvent batch in order', () => {
    const batch: Array<TurnEvent | MatchRulesEvent> = [
      { type: 'ROUND_ENDED', winnerIds: ['p2'] },
      { type: 'TOKEN_AWARDED', playerId: 'p2' },
      { type: 'TOKEN_AWARDED', playerId: 'p3' },
      { type: 'MATCH_ENDED', winnerIds: ['p2'] },
    ];

    expect(sanitizePublicEvents(batch)).toStrictEqual([
      { type: 'ROUND_ENDED', winnerIds: ['p2'] },
      { type: 'TOKEN_AWARDED', playerId: 'p2' },
      { type: 'TOKEN_AWARDED', playerId: 'p3' },
      { type: 'MATCH_ENDED', winnerIds: ['p2'] },
    ]);
  });

  it('returns a fresh empty array for an empty batch', () => {
    const output = sanitizePublicEvents([]);

    expect(output).toStrictEqual([]);
    expect(output).not.toBe(sanitizePublicEvents([]));
  });
});

describe('sanitizePublicEvents — fail-closed and purity', () => {
  it('throws a typed error for an unknown future event variant', () => {
    const futureEvent = { type: 'FUTURE_EVENT', secret: 'must-not-leak' } as unknown as TurnEvent;

    expect(() => sanitizePublicEvents([futureEvent])).toThrow(PublicEventError);
    try {
      sanitizePublicEvents([futureEvent]);
      throw new Error('expected sanitizePublicEvents to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(PublicEventError);
      expect((error as PublicEventError).code).toBe(PublicEventErrorCode.UnknownEventType);
    }
  });

  it('does not stop the batch on failure position and throws with the offending type', () => {
    const futureEvent = { type: 'FUTURE_EVENT' } as unknown as MatchRulesEvent;

    expect(() =>
      sanitizePublicEvents([{ type: 'CARD_DRAWN', playerId: 'p1' }, futureEvent]),
    ).toThrow(/FUTURE_EVENT/);
  });

  it('throws a typed UNKNOWN_PUBLIC_EVENT error for a malformed known-card payload', () => {
    const malformed = {
      type: 'CARD_PLAYED',
      playerId: 'p1',
      card: { value: 7 }, // missing `type`; not a valid card payload
    } as unknown as TurnEvent;

    expect(() => sanitizePublicEvents([malformed])).toThrow(PublicEventError);
    try {
      sanitizePublicEvents([malformed]);
      throw new Error('expected sanitizePublicEvents to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(PublicEventError);
      expect((error as PublicEventError).code).toBe(PublicEventErrorCode.UnknownPublicEvent);
      expect((error as PublicEventError).message).toContain('CARD_PLAYED');
    }
  });

  it('strips runtime extra fields that were not part of the documented shape', () => {
    const leaked = {
      type: 'CARD_PLAYED',
      playerId: 'p1',
      card: PLAYED_CARD,
      guessedValue: 9,
    } as unknown as TurnEvent;

    expect(sanitizePublicEvents([leaked])).toStrictEqual([
      {
        type: 'CARD_PLAYED',
        playerId: 'p1',
        card: { value: 7, type: 'MALABARISTA_DE_OCHO_PATAS' },
      },
    ]);
  });

  it('returns fresh objects: mutating the output never affects the input', () => {
    const input: TurnEvent = { type: 'CARD_PLAYED', playerId: 'p1', card: PLAYED_CARD };
    const inputCopy = jsonClone(input);
    const [output] = sanitizePublicEvents([input]);

    expect(output).not.toBe(input);
    (output as { card: { value: number } }).card.value = 999;
    (output as { playerId: string }).playerId = 'hacked';
    expect(input).toStrictEqual(inputCopy);
  });

  it('returns fresh objects: mutating the input never affects the output', () => {
    const input: TurnEvent = { type: 'CARD_PLAYED', playerId: 'p1', card: PLAYED_CARD };
    const [output] = sanitizePublicEvents([input]);
    const outputCopy = jsonClone(output);

    input.card.value = 999;
    input.card.instanceId = 'tampered';
    expect(output).toStrictEqual(outputCopy);
  });

  it('never mutates the input batch or its event objects', () => {
    const batch: Array<TurnEvent | MatchRulesEvent> = [
      { type: 'CARD_PLAYED', playerId: 'p1', card: PLAYED_CARD },
      { type: 'HANDS_REVEALED', hands: [{ playerId: 'p2', card: PLAYED_CARD }] },
    ];
    const batchCopy = jsonClone(batch);

    sanitizePublicEvents(batch);
    expect(batch).toStrictEqual(batchCopy);
  });
});
