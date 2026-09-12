/**
 * Milestone 5 work unit 2 — canonical state invariant checking (engine spec §20).
 *
 * Normative design under test:
 * - `findRoundInvariantViolations(round)` / `findMatchInvariantViolations(match)`
 *   return stable-coded violations without mutating their input;
 *   `assertRoundInvariants` / `assertMatchInvariants` throw one typed
 *   `InvariantViolationError` aggregating every detected violation.
 * - Round checks understand every valid transitional state: the canonical 21
 *   unique card instances are conserved across hands, public discards, the draw
 *   pile, the hidden card, and the detached Ratón pending card; exactly one Rey
 *   Gato exists; eliminated players are empty-handed and unprotected; the
 *   current actor of an active round is an active roster member in the turn
 *   order; DRAW_REQUIRED without a pending means one card per active hand and a
 *   nonempty pile; PLAY_REQUIRED without a pending means two cards for the
 *   actor and one for every other active player; an open pending means the
 *   pending actor is the current player in PLAY_REQUIRED holding one card with
 *   stage-specific structure valid; ROUND_END means nonempty, distinct,
 *   roster-active winners and no open pending.
 * - Match checks: 2–6 unique players, nonnegative integer victory tokens, and
 *   status/winners compatibility — winners are declared only at MATCH_END,
 *   where they must be distinct roster members at the victory threshold and
 *   must include every roster member at or above it (shared victory).
 * - Malformed shapes and card locations the public functions can safely accept
 *   yield violations instead of exceptions, including the detached Ratón
 *   pending card.
 * - Clean real flows (valid setup, every card path, round end, next round, and
 *   shared victory) must never produce a violation: every failure in this suite
 *   comes from exactly one injected corruption.
 */
import {
  applyRoundResult,
  applyTurnCommand,
  assertMatchInvariants,
  assertRoundInvariants,
  createMatchState,
  findMatchInvariantViolations,
  findRoundInvariantViolations,
  InvariantViolationError,
  setupRound,
  type CardInstance,
  type CardType,
  type InvariantCode,
  type MatchState,
  type PlayerId,
  type PlayerState,
  type RoundState,
} from '../src';
import { SeededRng } from '../src/rng';

type TurnResult = ReturnType<typeof applyTurnCommand>;
type SuccessfulTurn = Extract<TurnResult, { ok: true }>;

function createMatchAndRound(playerIds: PlayerId[]): { match: MatchState; round: RoundState } {
  const match = createMatchState({
    matchId: `match-${playerIds.join('-')}`,
    players: playerIds.map((id) => ({ id, name: id })),
  });
  const round = setupRound(match, new SeededRng(4242), ({ playerIds: ids }) => ids[0]);
  return { match, round };
}

function playerOf(round: RoundState, id: PlayerId): PlayerState {
  const player = round.players.find((candidate) => candidate.id === id);
  if (!player) {
    throw new Error(`Test fixture is missing player ${id}`);
  }
  return player;
}

function cloneRound(round: RoundState): RoundState {
  return JSON.parse(JSON.stringify(round)) as RoundState;
}

function cloneMatch(match: MatchState): MatchState {
  return JSON.parse(JSON.stringify(match)) as MatchState;
}

function expectTurnSuccess(result: TurnResult): SuccessfulTurn {
  if (!result.ok) {
    throw new Error(`Expected a successful turn command, got error ${String(result.error)}`);
  }
  return result;
}

function expectRoundViolation(round: RoundState, ...codes: InvariantCode[]): void {
  const violations = findRoundInvariantViolations(round);
  const actualCodes = violations.map((violation) => violation.code);
  for (const code of codes) {
    expect(actualCodes).toContain(code);
  }
  expect(violations.length).toBeGreaterThan(0);
}

function expectMatchViolation(match: MatchState, ...codes: InvariantCode[]): void {
  const violations = findMatchInvariantViolations(match);
  const actualCodes = violations.map((violation) => violation.code);
  for (const code of codes) {
    expect(actualCodes).toContain(code);
  }
  expect(violations.length).toBeGreaterThan(0);
}

/**
 * Conservation-preserving card extraction: takes one card of the wanted type
 * from the draw pile when possible, otherwise swaps it out of another player's
 * hand or the hidden card while keeping every location count valid.
 */
function extractCardOfType(round: RoundState, type: CardType): CardInstance {
  const pileIndex = round.drawPile.findIndex((card) => card.type === type);
  if (pileIndex >= 0) {
    return round.drawPile.splice(pileIndex, 1)[0]!;
  }
  for (const player of round.players) {
    const handIndex = player.hand.findIndex((card) => card.type === type);
    if (handIndex >= 0) {
      const card = player.hand.splice(handIndex, 1)[0]!;
      if (round.drawPile.length > 0) {
        player.hand.push(round.drawPile.pop()!);
      }
      return card;
    }
  }
  if (round.hiddenCard?.type === type && round.drawPile.length > 0) {
    const card = round.hiddenCard;
    round.hiddenCard = round.drawPile.pop()!;
    return card;
  }
  throw new Error(`Test fixture found no ${type} card to place`);
}

/**
 * Conservation-preserving hand staging: returns the player's current hand cards
 * to the draw pile, then deals exactly the requested card types. One type keeps
 * a valid DRAW_REQUIRED hand; two types keep a valid mid-turn PLAY_REQUIRED hand.
 */
function stageHand(round: RoundState, playerId: PlayerId, types: CardType[]): CardInstance[] {
  const player = playerOf(round, playerId);
  const previous = player.hand.splice(0);
  round.drawPile.push(...previous);
  player.hand = types.map((type) => extractCardOfType(round, type));
  return player.hand;
}

/** Stages the actor (the current player by fixture) into PLAY_REQUIRED. */
function stagePlayPhase(round: RoundState, actorId: PlayerId): void {
  round.phase = 'PLAY_REQUIRED';
  round.currentPlayerId = actorId;
}

/**
 * Drives a real Pecera elimination of charlie (curated to hold the Ratón, value
 * 2, so the correct guess 2 is legal): charlie ends eliminated, empty-handed,
 * unprotected, and the turn advanced to bravo in DRAW_REQUIRED.
 */
function stageEliminatedThirdPlayer(round: RoundState): RoundState {
  stageHand(round, 'charlie', ['RATON_TRAMPERO']);
  const [pecera] = stageHand(round, 'alpha', ['PECERA_DE_CRISTAL', 'CAPARAZON_ARMAZON']);
  stagePlayPhase(round, 'alpha');
  const played = expectTurnSuccess(
    applyTurnCommand(round, {
      type: 'PLAY_CARD',
      actorId: 'alpha',
      cardInstanceId: pecera.instanceId,
    }),
  ).state;
  const targeted = expectTurnSuccess(
    applyTurnCommand(played, { type: 'CHOOSE_TARGET', actorId: 'alpha', targetId: 'charlie' }),
  ).state;
  const resolved = expectTurnSuccess(
    applyTurnCommand(targeted, { type: 'SUBMIT_GUESS', actorId: 'alpha', value: 2 }),
  ).state;
  expect(resolved.status).toBe('ROUND_ACTIVE');
  expect(playerOf(resolved, 'charlie').eliminated).toBe(true);
  expect(findRoundInvariantViolations(resolved)).toEqual([]);
  return resolved;
}

/**
 * Drives a real two-player round to its end: alpha correctly guesses bravo's
 * Ratón (value 2) through Pecera, leaving alpha as the sole survivor.
 */
function endedRoundByElimination(): { match: MatchState; round: RoundState } {
  const { match, round } = createMatchAndRound(['alpha', 'bravo']);
  stageHand(round, 'bravo', ['RATON_TRAMPERO']);
  const [pecera] = stageHand(round, 'alpha', ['PECERA_DE_CRISTAL', 'CAPARAZON_ARMAZON']);
  stagePlayPhase(round, 'alpha');
  const played = expectTurnSuccess(
    applyTurnCommand(round, {
      type: 'PLAY_CARD',
      actorId: 'alpha',
      cardInstanceId: pecera.instanceId,
    }),
  ).state;
  const targeted = expectTurnSuccess(
    applyTurnCommand(played, { type: 'CHOOSE_TARGET', actorId: 'alpha', targetId: 'bravo' }),
  ).state;
  const resolved = expectTurnSuccess(
    applyTurnCommand(targeted, { type: 'SUBMIT_GUESS', actorId: 'alpha', value: 2 }),
  ).state;
  expect(resolved.status).toBe('ROUND_END');
  expect(resolved.winners).toEqual(['alpha']);
  expect(findRoundInvariantViolations(resolved)).toEqual([]);
  return { match, round: resolved };
}

/** Curates a structurally valid ended round for the given match and winner. */
function curateEndedRound(match: MatchState, winnerId: PlayerId): RoundState {
  return curateEndedRoundWithWinners(match, [winnerId]);
}

/** Curates a structurally valid ended round declaring the given winners. */
function curateEndedRoundWithWinners(match: MatchState, winnerIds: PlayerId[]): RoundState {
  const round = setupRound(match, new SeededRng(11));
  round.status = 'ROUND_END';
  round.roundNumber = match.roundNumber + 1;
  round.winners = winnerIds;
  return round;
}

function applyCuratedRound(match: MatchState, winners: PlayerId[]): MatchState {
  return applyRoundResult(match, curateEndedRoundWithWinners(match, winners)).match;
}

/**
 * Drives a real 2-player match to a shared MATCH_END: alpha wins the elimination
 * round, bravo the next, then both survive two shared-victory rounds until each
 * holds the 3-token threshold (rules §3, §11).
 */
function matchAtSharedMatchEnd(): MatchState {
  const { match, round } = endedRoundByElimination();
  const afterFirst = applyRoundResult(match, round).match;
  const afterSecond = applyCuratedRound(afterFirst, ['bravo']);
  const afterThird = applyCuratedRound(afterSecond, ['alpha', 'bravo']);
  return applyCuratedRound(afterThird, ['alpha', 'bravo']);
}

/** Drives a real Pecera play that opens the PECERA_TARGET pending stage. */
function stagePeceraTargetPending(round: RoundState): RoundState {
  const [pecera] = stageHand(round, 'alpha', ['PECERA_DE_CRISTAL', 'CAPARAZON_ARMAZON']);
  stagePlayPhase(round, 'alpha');
  return expectTurnSuccess(
    applyTurnCommand(round, {
      type: 'PLAY_CARD',
      actorId: 'alpha',
      cardInstanceId: pecera.instanceId,
    }),
  ).state;
}

describe('findRoundInvariantViolations — clean real flows', () => {
  it('accepts a valid setup for 2, 3, and 6 players', () => {
    for (const playerIds of [
      ['alpha', 'bravo'],
      ['alpha', 'bravo', 'charlie'],
      ['a', 'b', 'c', 'd', 'e', 'f'],
    ]) {
      const { round } = createMatchAndRound(playerIds);
      expect(findRoundInvariantViolations(round)).toEqual([]);
    }
  });

  it('accepts the draw transition into PLAY_REQUIRED', () => {
    const { round } = createMatchAndRound(['alpha', 'bravo', 'charlie']);
    const drawn = expectTurnSuccess(
      applyTurnCommand(round, { type: 'DRAW_CARD', actorId: round.currentPlayerId }),
    ).state;
    expect(drawn.phase).toBe('PLAY_REQUIRED');
    expect(findRoundInvariantViolations(drawn)).toEqual([]);
  });

  it('accepts the Robot Aspirador Real path', () => {
    const { round } = createMatchAndRound(['alpha', 'bravo', 'charlie']);
    const [robot] = stageHand(round, 'alpha', ['ROBOT_ASPIRADOR_REAL', 'CAPARAZON_ARMAZON']);
    stagePlayPhase(round, 'alpha');
    expect(findRoundInvariantViolations(round)).toEqual([]);
    const played = expectTurnSuccess(
      applyTurnCommand(round, {
        type: 'PLAY_CARD',
        actorId: 'alpha',
        cardInstanceId: robot.instanceId,
      }),
    ).state;
    expect(findRoundInvariantViolations(played)).toEqual([]);
  });

  it('accepts the Caparazón Armazón path (self-protection)', () => {
    const { round } = createMatchAndRound(['alpha', 'bravo', 'charlie']);
    const [caparazon] = stageHand(round, 'alpha', ['CAPARAZON_ARMAZON', 'PECERA_DE_CRISTAL']);
    stagePlayPhase(round, 'alpha');
    const played = expectTurnSuccess(
      applyTurnCommand(round, {
        type: 'PLAY_CARD',
        actorId: 'alpha',
        cardInstanceId: caparazon.instanceId,
      }),
    ).state;
    expect(playerOf(played, 'alpha').protected).toBe(true);
    expect(findRoundInvariantViolations(played)).toEqual([]);
  });

  it('accepts the Pecera de Cristal path with a wrong guess', () => {
    const { round } = createMatchAndRound(['alpha', 'bravo', 'charlie']);
    const [pecera] = stageHand(round, 'alpha', ['PECERA_DE_CRISTAL', 'CAPARAZON_ARMAZON']);
    stagePlayPhase(round, 'alpha');
    const played = expectTurnSuccess(
      applyTurnCommand(round, {
        type: 'PLAY_CARD',
        actorId: 'alpha',
        cardInstanceId: pecera.instanceId,
      }),
    ).state;
    expect(findRoundInvariantViolations(played)).toEqual([]);
    const targeted = expectTurnSuccess(
      applyTurnCommand(played, { type: 'CHOOSE_TARGET', actorId: 'alpha', targetId: 'bravo' }),
    ).state;
    expect(findRoundInvariantViolations(targeted)).toEqual([]);
    const bravoValue = playerOf(targeted, 'bravo').hand[0]!.value;
    const wrongGuess = bravoValue === 0 ? 2 : 0;
    const resolved = expectTurnSuccess(
      applyTurnCommand(targeted, { type: 'SUBMIT_GUESS', actorId: 'alpha', value: wrongGuess }),
    ).state;
    expect(findRoundInvariantViolations(resolved)).toEqual([]);
  });

  it('accepts the Pecera de Cristal path with a correct elimination guess', () => {
    const { round } = createMatchAndRound(['alpha', 'bravo', 'charlie']);
    expect(findRoundInvariantViolations(stageEliminatedThirdPlayer(round))).toEqual([]);
  });

  it('accepts the Ratón Trampero path with the detached pending card', () => {
    const { round } = createMatchAndRound(['alpha', 'bravo', 'charlie']);
    const [raton] = stageHand(round, 'alpha', ['RATON_TRAMPERO', 'CAPARAZON_ARMAZON']);
    stagePlayPhase(round, 'alpha');
    const pending = expectTurnSuccess(
      applyTurnCommand(round, {
        type: 'PLAY_CARD',
        actorId: 'alpha',
        cardInstanceId: raton.instanceId,
      }),
    ).state;
    expect(pending.pendingInteraction?.type).toBe('RATON_INSERT_POSITION');
    expect(findRoundInvariantViolations(pending)).toEqual([]);
    const resolved = expectTurnSuccess(
      applyTurnCommand(pending, { type: 'CHOOSE_DECK_POSITION', actorId: 'alpha', index: 0 }),
    ).state;
    expect(findRoundInvariantViolations(resolved)).toEqual([]);
  });

  it('accepts the Conejito Guerrillero path eliminating a lower hand', () => {
    const { round } = createMatchAndRound(['alpha', 'bravo', 'charlie']);
    stageHand(round, 'bravo', ['ROBOT_ASPIRADOR_REAL']);
    const [conejito] = stageHand(round, 'alpha', [
      'CONEJITO_GUERRILLERO',
      'MALABARISTA_DE_OCHO_PATAS',
    ]);
    stagePlayPhase(round, 'alpha');
    const played = expectTurnSuccess(
      applyTurnCommand(round, {
        type: 'PLAY_CARD',
        actorId: 'alpha',
        cardInstanceId: conejito.instanceId,
        targetId: 'bravo',
      }),
    ).state;
    expect(playerOf(played, 'bravo').eliminated).toBe(true);
    expect(findRoundInvariantViolations(played)).toEqual([]);
  });

  it('accepts the Serpiente Encantadora forced-play path', () => {
    const { round } = createMatchAndRound(['alpha', 'bravo', 'charlie']);
    stageHand(round, 'bravo', ['RATON_TRAMPERO']);
    const [serpiente] = stageHand(round, 'alpha', ['SERPIENTE_ENCANTADORA', 'CAPARAZON_ARMAZON']);
    stagePlayPhase(round, 'alpha');
    const played = expectTurnSuccess(
      applyTurnCommand(round, {
        type: 'PLAY_CARD',
        actorId: 'alpha',
        cardInstanceId: serpiente.instanceId,
        targetId: 'bravo',
      }),
    ).state;
    expect(findRoundInvariantViolations(played)).toEqual([]);
  });

  it('accepts the Saqueadog de Tumbas path for both swap choices', () => {
    const { round } = createMatchAndRound(['alpha', 'bravo', 'charlie']);
    const [saqueadog] = stageHand(round, 'alpha', ['SAQUEADOG_DE_TUMBAS', 'CAPARAZON_ARMAZON']);
    stagePlayPhase(round, 'alpha');
    const pending = expectTurnSuccess(
      applyTurnCommand(round, {
        type: 'PLAY_CARD',
        actorId: 'alpha',
        cardInstanceId: saqueadog.instanceId,
      }),
    ).state;
    expect(pending.pendingInteraction?.type).toBe('SAQUEADOG_SWAP');
    expect(findRoundInvariantViolations(pending)).toEqual([]);
    const kept = expectTurnSuccess(
      applyTurnCommand(pending, { type: 'CHOOSE_HIDDEN_SWAP', actorId: 'alpha', swap: false }),
    ).state;
    expect(findRoundInvariantViolations(kept)).toEqual([]);
    const swapped = expectTurnSuccess(
      applyTurnCommand(cloneRound(pending), {
        type: 'CHOOSE_HIDDEN_SWAP',
        actorId: 'alpha',
        swap: true,
      }),
    ).state;
    expect(findRoundInvariantViolations(swapped)).toEqual([]);
  });

  it('accepts the Malabarista de Ocho Patas global redeal path', () => {
    const { round } = createMatchAndRound(['alpha', 'bravo', 'charlie']);
    const [malabarista] = stageHand(round, 'alpha', [
      'MALABARISTA_DE_OCHO_PATAS',
      'CAPARAZON_ARMAZON',
    ]);
    stagePlayPhase(round, 'alpha');
    const played = expectTurnSuccess(
      applyTurnCommand(
        round,
        { type: 'PLAY_CARD', actorId: 'alpha', cardInstanceId: malabarista.instanceId },
        { rng: new SeededRng(7) },
      ),
    ).state;
    expect(findRoundInvariantViolations(played)).toEqual([]);
  });

  it('accepts the Ermitaño Busca Casa hand-swap path', () => {
    const { round } = createMatchAndRound(['alpha', 'bravo', 'charlie']);
    const [ermitano] = stageHand(round, 'alpha', ['ERMITANO_BUSCA_CASA', 'CAPARAZON_ARMAZON']);
    stagePlayPhase(round, 'alpha');
    const played = expectTurnSuccess(
      applyTurnCommand(round, {
        type: 'PLAY_CARD',
        actorId: 'alpha',
        cardInstanceId: ermitano.instanceId,
        targetId: 'bravo',
      }),
    ).state;
    expect(findRoundInvariantViolations(played)).toEqual([]);
  });

  it('accepts the ¡No soy una mascota! Rey Gato exchange path', () => {
    const { round } = createMatchAndRound(['alpha', 'bravo', 'charlie']);
    stageHand(round, 'bravo', ['REY_GATO']);
    const [noSoy] = stageHand(round, 'alpha', ['NO_SOY_UNA_MASCOTA', 'CAPARAZON_ARMAZON']);
    stagePlayPhase(round, 'alpha');
    const played = expectTurnSuccess(
      applyTurnCommand(round, {
        type: 'PLAY_CARD',
        actorId: 'alpha',
        cardInstanceId: noSoy.instanceId,
      }),
    ).state;
    expect(playerOf(played, 'alpha').hand[0]?.type).toBe('REY_GATO');
    expect(playerOf(played, 'bravo').hand[0]?.type).toBe('CAPARAZON_ARMAZON');
    expect(findRoundInvariantViolations(played)).toEqual([]);
  });

  it('accepts the Rey Gato path eliminating its own holder', () => {
    const { round } = createMatchAndRound(['alpha', 'bravo', 'charlie']);
    const [reyGato] = stageHand(round, 'alpha', ['REY_GATO', 'CAPARAZON_ARMAZON']);
    stagePlayPhase(round, 'alpha');
    const played = expectTurnSuccess(
      applyTurnCommand(round, {
        type: 'PLAY_CARD',
        actorId: 'alpha',
        cardInstanceId: reyGato.instanceId,
      }),
    ).state;
    expect(playerOf(played, 'alpha').eliminated).toBe(true);
    expect(findRoundInvariantViolations(played)).toEqual([]);
  });

  it('accepts a round ended by elimination down to one survivor', () => {
    const { round } = endedRoundByElimination();
    expect(findRoundInvariantViolations(round)).toEqual([]);
  });

  it('accepts a 2-player Rey Gato self-elimination round end with an eliminated current player', () => {
    const { round } = createMatchAndRound(['alpha', 'bravo']);
    const [reyGato] = stageHand(round, 'alpha', ['REY_GATO', 'CAPARAZON_ARMAZON']);
    stagePlayPhase(round, 'alpha');
    const ended = expectTurnSuccess(
      applyTurnCommand(round, {
        type: 'PLAY_CARD',
        actorId: 'alpha',
        cardInstanceId: reyGato.instanceId,
      }),
    ).state;
    expect(ended.status).toBe('ROUND_END');
    expect(ended.winners).toEqual(['bravo']);
    expect(playerOf(ended, 'alpha').eliminated).toBe(true);
    expect(ended.currentPlayerId).toBe('alpha');
    expect(findRoundInvariantViolations(ended)).toEqual([]);
    expect(() => assertRoundInvariants(ended)).not.toThrow();
  });

  it('accepts an exhaustion round end shared by two winners', () => {
    const { round } = createMatchAndRound(['alpha', 'bravo', 'charlie']);
    const [reyGato] = stageHand(round, 'alpha', ['REY_GATO', 'MALABARISTA_DE_OCHO_PATAS']);
    stageHand(round, 'bravo', ['PECERA_DE_CRISTAL']);
    stageHand(round, 'charlie', ['PECERA_DE_CRISTAL']);
    stagePlayPhase(round, 'alpha');
    expect(findRoundInvariantViolations(round)).toEqual([]);

    // Alpha self-eliminates with the Rey Gato (catalog §10): two survivors remain.
    const eliminated = expectTurnSuccess(
      applyTurnCommand(round, {
        type: 'PLAY_CARD',
        actorId: 'alpha',
        cardInstanceId: reyGato.instanceId,
      }),
    ).state;
    expect(playerOf(eliminated, 'alpha').eliminated).toBe(true);
    expect(findRoundInvariantViolations(eliminated)).toEqual([]);

    // Consolidate the pile to exactly the two Caparazón plays the survivors need;
    // every other card moves into the eliminated player's public discard area so
    // the 21 canonical instances stay conserved. The survivors then discard one
    // Caparazón each (equal tie-break totals) and reveal equal Peceras.
    const caparazonA = extractCardOfType(eliminated, 'CAPARAZON_ARMAZON');
    const caparazonB = extractCardOfType(eliminated, 'CAPARAZON_ARMAZON');
    const rest = eliminated.drawPile.splice(0);
    playerOf(eliminated, 'alpha').discards.push(
      ...rest.map((card) => ({ card, origin: 'PLAYED' as const })),
    );
    eliminated.drawPile = [caparazonA, caparazonB];
    expect(findRoundInvariantViolations(eliminated)).toEqual([]);

    const bravoDrew = expectTurnSuccess(
      applyTurnCommand(eliminated, { type: 'DRAW_CARD', actorId: 'bravo' }),
    ).state;
    expect(findRoundInvariantViolations(bravoDrew)).toEqual([]);
    const bravoPlayed = expectTurnSuccess(
      applyTurnCommand(bravoDrew, {
        type: 'PLAY_CARD',
        actorId: 'bravo',
        cardInstanceId: caparazonA.instanceId,
      }),
    ).state;
    expect(findRoundInvariantViolations(bravoPlayed)).toEqual([]);

    const charlieDrew = expectTurnSuccess(
      applyTurnCommand(bravoPlayed, { type: 'DRAW_CARD', actorId: 'charlie' }),
    ).state;
    expect(findRoundInvariantViolations(charlieDrew)).toEqual([]);
    const ended = expectTurnSuccess(
      applyTurnCommand(charlieDrew, {
        type: 'PLAY_CARD',
        actorId: 'charlie',
        cardInstanceId: caparazonB.instanceId,
      }),
    ).state;
    expect(ended.status).toBe('ROUND_END');
    expect([...ended.winners].sort()).toEqual(['bravo', 'charlie']);
    expect(findRoundInvariantViolations(ended)).toEqual([]);
  });

  it('accepts the next round after applying a round result', () => {
    const { match, round } = endedRoundByElimination();
    const applied = applyRoundResult(match, round);
    expect(findMatchInvariantViolations(applied.match)).toEqual([]);
    const nextRound = setupRound(applied.match, new SeededRng(9));
    expect(findRoundInvariantViolations(nextRound)).toEqual([]);
  });
});

describe('findRoundInvariantViolations — single card corruptions', () => {
  it('flags a duplicated card instance', () => {
    const { round } = createMatchAndRound(['alpha', 'bravo', 'charlie']);
    const corrupted = cloneRound(round);
    const handCard = playerOf(corrupted, 'alpha').hand[0]!;
    corrupted.drawPile.push({ ...handCard });
    expectRoundViolation(corrupted, 'CARD_CONSERVATION');
    const violations = findRoundInvariantViolations(corrupted);
    expect(
      violations.some(
        (violation) =>
          violation.code === 'CARD_CONSERVATION' && violation.detail.includes(handCard.instanceId),
      ),
    ).toBe(true);
  });

  it('flags a missing card instance', () => {
    const { round } = createMatchAndRound(['alpha', 'bravo', 'charlie']);
    const corrupted = cloneRound(round);
    const missing = corrupted.drawPile.pop()!;
    expectRoundViolation(corrupted, 'CARD_CONSERVATION');
    const violations = findRoundInvariantViolations(corrupted);
    expect(
      violations.some(
        (violation) =>
          violation.code === 'CARD_CONSERVATION' && violation.detail.includes(missing.instanceId),
      ),
    ).toBe(true);
  });

  it('flags an unknown card instance', () => {
    const { round } = createMatchAndRound(['alpha', 'bravo', 'charlie']);
    const corrupted = cloneRound(round);
    corrupted.drawPile.push({
      instanceId: 'foreign-instance',
      value: 3,
      type: 'CONEJITO_GUERRILLERO',
    });
    expectRoundViolation(corrupted, 'CARD_CONSERVATION');
  });

  it('flags a card whose value no longer matches the catalog', () => {
    const { round } = createMatchAndRound(['alpha', 'bravo', 'charlie']);
    const corrupted = cloneRound(round);
    corrupted.drawPile[0]!.value = 99;
    expectRoundViolation(corrupted, 'CARD_CONSERVATION');
  });

  it('flags a duplicated Rey Gato', () => {
    const { round } = createMatchAndRound(['alpha', 'bravo', 'charlie']);
    const corrupted = cloneRound(round);
    const reyGato =
      corrupted.players.flatMap((player) => player.hand).find((card) => card.type === 'REY_GATO') ??
      corrupted.drawPile.find((card) => card.type === 'REY_GATO') ??
      corrupted.hiddenCard;
    corrupted.drawPile.push({ ...reyGato });
    expectRoundViolation(corrupted, 'CARD_CONSERVATION', 'REY_GATO_UNIQUENESS');
  });
});

describe('findRoundInvariantViolations — single structural corruptions', () => {
  it('flags an eliminated player still holding a hand card', () => {
    const corrupted = stageEliminatedThirdPlayer(
      createMatchAndRound(['alpha', 'bravo', 'charlie']).round,
    );
    playerOf(corrupted, 'charlie').hand.push(corrupted.drawPile.pop()!);
    expectRoundViolation(corrupted, 'ELIMINATED_PLAYER_STATE');
  });

  it('flags an eliminated player still protected', () => {
    const corrupted = stageEliminatedThirdPlayer(
      createMatchAndRound(['alpha', 'bravo', 'charlie']).round,
    );
    playerOf(corrupted, 'charlie').protected = true;
    expectRoundViolation(corrupted, 'ELIMINATED_PLAYER_STATE');
  });

  it('flags an eliminated current actor', () => {
    const corrupted = stageEliminatedThirdPlayer(
      createMatchAndRound(['alpha', 'bravo', 'charlie']).round,
    );
    corrupted.currentPlayerId = 'charlie';
    expectRoundViolation(corrupted, 'CURRENT_ACTOR_STATE');
  });

  it('flags a current actor missing from the turn order', () => {
    const { round } = createMatchAndRound(['alpha', 'bravo', 'charlie']);
    const corrupted = cloneRound(round);
    corrupted.turnOrder = corrupted.turnOrder.filter((id) => id !== corrupted.currentPlayerId);
    expectRoundViolation(corrupted, 'CURRENT_ACTOR_STATE');
  });

  it('flags an active player holding two cards in DRAW_REQUIRED', () => {
    const { round } = createMatchAndRound(['alpha', 'bravo', 'charlie']);
    const corrupted = cloneRound(round);
    playerOf(corrupted, 'alpha').hand.push(corrupted.drawPile.pop()!);
    expectRoundViolation(corrupted, 'PHASE_STRUCTURE');
  });

  it('flags a non-actor active player holding two cards in DRAW_REQUIRED', () => {
    const { round } = createMatchAndRound(['alpha', 'bravo', 'charlie']);
    const corrupted = cloneRound(round);
    playerOf(corrupted, 'bravo').hand.push(corrupted.drawPile.pop()!);
    expectRoundViolation(corrupted, 'PHASE_STRUCTURE');
  });

  it('flags an empty draw pile in DRAW_REQUIRED', () => {
    const { round } = createMatchAndRound(['alpha', 'bravo', 'charlie']);
    const corrupted = cloneRound(round);
    const moved = corrupted.drawPile.splice(0);
    playerOf(corrupted, 'alpha').discards.push(
      ...moved.map((card) => ({ card, origin: 'PLAYED' as const })),
    );
    expectRoundViolation(corrupted, 'PHASE_STRUCTURE');
  });

  it('flags the current actor holding one card in PLAY_REQUIRED without a pending', () => {
    const { round } = createMatchAndRound(['alpha', 'bravo', 'charlie']);
    const corrupted = cloneRound(round);
    stageHand(corrupted, 'alpha', ['PECERA_DE_CRISTAL', 'CAPARAZON_ARMAZON']);
    stagePlayPhase(corrupted, 'alpha');
    corrupted.drawPile.push(...playerOf(corrupted, 'alpha').hand.splice(1));
    expectRoundViolation(corrupted, 'PHASE_STRUCTURE');
  });

  it('flags another active player holding two cards in PLAY_REQUIRED', () => {
    const { round } = createMatchAndRound(['alpha', 'bravo', 'charlie']);
    const corrupted = cloneRound(round);
    stageHand(corrupted, 'alpha', ['PECERA_DE_CRISTAL', 'CAPARAZON_ARMAZON']);
    stagePlayPhase(corrupted, 'alpha');
    playerOf(corrupted, 'bravo').hand.push(corrupted.drawPile.pop()!);
    expectRoundViolation(corrupted, 'PHASE_STRUCTURE');
  });

  it('flags an unknown turn phase', () => {
    const { round } = createMatchAndRound(['alpha', 'bravo', 'charlie']);
    const corrupted = cloneRound(round);
    (corrupted as { phase: string }).phase = 'RESOLVING';
    expectRoundViolation(corrupted, 'STATE_SHAPE');
  });

  it('flags an unknown round status', () => {
    const { round } = createMatchAndRound(['alpha', 'bravo', 'charlie']);
    const corrupted = cloneRound(round);
    (corrupted as { status: string }).status = 'LOBBY';
    expectRoundViolation(corrupted, 'STATE_SHAPE');
  });
});

describe('findRoundInvariantViolations — single pending corruptions', () => {
  it('flags an open pending interaction outside PLAY_REQUIRED', () => {
    const { round } = createMatchAndRound(['alpha', 'bravo', 'charlie']);
    const corrupted = stagePeceraTargetPending(round);
    corrupted.phase = 'DRAW_REQUIRED';
    expectRoundViolation(corrupted, 'PENDING_STRUCTURE');
  });

  it('flags a pending interaction owned by another player than the current actor', () => {
    const { round } = createMatchAndRound(['alpha', 'bravo', 'charlie']);
    const corrupted = stagePeceraTargetPending(round);
    corrupted.currentPlayerId = 'bravo';
    expectRoundViolation(corrupted, 'PENDING_STRUCTURE');
  });

  it('flags a pending actor holding two cards', () => {
    const { round } = createMatchAndRound(['alpha', 'bravo', 'charlie']);
    const corrupted = stagePeceraTargetPending(round);
    playerOf(corrupted, 'alpha').hand.push(corrupted.drawPile.pop()!);
    expectRoundViolation(corrupted, 'PENDING_STRUCTURE');
  });

  it('flags a PECERA_GUESS stage whose target is eliminated', () => {
    const { round } = createMatchAndRound(['alpha', 'bravo', 'charlie']);
    const targetPending = stagePeceraTargetPending(round);
    const guessPending = expectTurnSuccess(
      applyTurnCommand(targetPending, {
        type: 'CHOOSE_TARGET',
        actorId: 'alpha',
        targetId: 'bravo',
      }),
    ).state;
    expect(guessPending.pendingInteraction?.type).toBe('PECERA_GUESS');
    const bravo = playerOf(guessPending, 'bravo');
    bravo.eliminated = true;
    guessPending.drawPile.push(...bravo.hand.splice(0));
    expectRoundViolation(guessPending, 'PENDING_STRUCTURE');
  });
});

describe('findRoundInvariantViolations — single round-end corruptions', () => {
  it('flags an ended round without winners', () => {
    const { round } = endedRoundByElimination();
    const corrupted = cloneRound(round);
    corrupted.winners = [];
    expectRoundViolation(corrupted, 'ROUND_END_STRUCTURE');
  });

  it('flags duplicated round winners', () => {
    const { round } = endedRoundByElimination();
    const corrupted = cloneRound(round);
    corrupted.winners = ['alpha', 'alpha'];
    expectRoundViolation(corrupted, 'ROUND_END_STRUCTURE');
  });

  it('flags a round winner outside the roster', () => {
    const { round } = endedRoundByElimination();
    const corrupted = cloneRound(round);
    corrupted.winners = ['ghost'];
    expectRoundViolation(corrupted, 'ROUND_END_STRUCTURE');
  });

  it('flags an eliminated round winner', () => {
    const { round } = endedRoundByElimination();
    const corrupted = cloneRound(round);
    const alpha = playerOf(corrupted, 'alpha');
    alpha.eliminated = true;
    corrupted.drawPile.push(...alpha.hand.splice(0));
    expectRoundViolation(corrupted, 'ROUND_END_STRUCTURE');
  });

  it('flags an ended round that still carries an open pending interaction', () => {
    const { round } = endedRoundByElimination();
    const corrupted = cloneRound(round);
    corrupted.pendingInteraction = { type: 'SAQUEADOG_SWAP', actorId: 'alpha' };
    expectRoundViolation(corrupted, 'ROUND_END_STRUCTURE');
  });
});

describe('findRoundInvariantViolations — malformed shapes and card locations', () => {
  function stagedRatonPending(): RoundState {
    const { round } = createMatchAndRound(['alpha', 'bravo', 'charlie']);
    const [raton] = stageHand(round, 'alpha', ['RATON_TRAMPERO', 'CAPARAZON_ARMAZON']);
    stagePlayPhase(round, 'alpha');
    const pending = expectTurnSuccess(
      applyTurnCommand(round, {
        type: 'PLAY_CARD',
        actorId: 'alpha',
        cardInstanceId: raton.instanceId,
      }),
    ).state;
    expect(pending.pendingInteraction?.type).toBe('RATON_INSERT_POSITION');
    return pending;
  }

  it('flags a malformed detached Ratón pending card', () => {
    const corrupted = cloneRound(stagedRatonPending());
    (corrupted.pendingInteraction as { card: unknown }).card = undefined;
    expectRoundViolation(corrupted, 'CARD_CONSERVATION');
    const violations = findRoundInvariantViolations(corrupted);
    expect(
      violations.some(
        (violation) =>
          violation.code === 'CARD_CONSERVATION' &&
          violation.detail.includes('pendingInteraction.card'),
      ),
    ).toBe(true);
  });

  it('flags a card instance duplicated into the detached Ratón pending slot', () => {
    const corrupted = cloneRound(stagedRatonPending());
    const ratonCard = (corrupted.pendingInteraction as { card: CardInstance }).card;
    playerOf(corrupted, 'bravo').hand.push({ ...ratonCard });
    expectRoundViolation(corrupted, 'CARD_CONSERVATION');
    const violations = findRoundInvariantViolations(corrupted);
    expect(
      violations.some(
        (violation) =>
          violation.code === 'CARD_CONSERVATION' &&
          violation.detail.includes(ratonCard.instanceId) &&
          violation.detail.includes('pendingInteraction.card'),
      ),
    ).toBe(true);
  });

  it('flags a malformed non-object pending interaction without throwing', () => {
    const { round } = createMatchAndRound(['alpha', 'bravo', 'charlie']);
    const corrupted = cloneRound(round);
    (corrupted as { pendingInteraction: unknown }).pendingInteraction = 'junk';
    expectRoundViolation(corrupted, 'STATE_SHAPE');
  });
});

describe('assertRoundInvariants', () => {
  it('does not throw on a clean real flow state', () => {
    const { round } = createMatchAndRound(['alpha', 'bravo', 'charlie']);
    expect(() => assertRoundInvariants(round)).not.toThrow();
  });

  it('throws one typed error aggregating every violation of a corrupted state', () => {
    const { round } = createMatchAndRound(['alpha', 'bravo', 'charlie']);
    const corrupted = cloneRound(round);
    const reyGato =
      corrupted.players.flatMap((player) => player.hand).find((card) => card.type === 'REY_GATO') ??
      corrupted.drawPile.find((card) => card.type === 'REY_GATO') ??
      corrupted.hiddenCard;
    corrupted.drawPile.push({ ...reyGato });
    let caught: unknown;
    try {
      assertRoundInvariants(corrupted);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(InvariantViolationError);
    const invariantError = caught as InvariantViolationError;
    expect(invariantError.violations.length).toBeGreaterThan(0);
    expect(invariantError.violations.map((violation) => violation.code)).toContain(
      'CARD_CONSERVATION',
    );
    expect(invariantError.violations.map((violation) => violation.code)).toContain(
      'REY_GATO_UNIQUENESS',
    );
    expect(invariantError.message).toContain('CARD_CONSERVATION');
  });

  it('never mutates the inspected round state', () => {
    const { round } = createMatchAndRound(['alpha', 'bravo', 'charlie']);
    stageHand(round, 'alpha', ['PECERA_DE_CRISTAL', 'CAPARAZON_ARMAZON']);
    stagePlayPhase(round, 'alpha');
    const snapshot = cloneRound(round);
    findRoundInvariantViolations(round);
    expect(cloneRound(round)).toEqual(snapshot);
  });

  it('is deterministic across repeated calls', () => {
    const { round } = createMatchAndRound(['alpha', 'bravo', 'charlie']);
    expect(findRoundInvariantViolations(round)).toEqual(findRoundInvariantViolations(round));
  });
});

describe('findMatchInvariantViolations — clean flows', () => {
  it('accepts a lobby match', () => {
    const match = createMatchState({
      matchId: 'match-invariants',
      players: [
        { id: 'alpha', name: 'alpha' },
        { id: 'bravo', name: 'bravo' },
      ],
    });
    expect(findMatchInvariantViolations(match)).toEqual([]);
  });

  it('accepts a match between rounds and at MATCH_END', () => {
    const { match, round } = endedRoundByElimination();
    const afterFirst = applyRoundResult(match, round).match;
    expect(afterFirst.status).toBe('ROUND_END');
    expect(findMatchInvariantViolations(afterFirst)).toEqual([]);

    const afterSecond = applyRoundResult(afterFirst, curateEndedRound(afterFirst, 'alpha')).match;
    expect(findMatchInvariantViolations(afterSecond)).toEqual([]);

    const afterThird = applyRoundResult(afterSecond, curateEndedRound(afterSecond, 'alpha')).match;
    expect(afterThird.status).toBe('MATCH_END');
    expect(afterThird.winners).toEqual(['alpha']);
    expect(findMatchInvariantViolations(afterThird)).toEqual([]);
  });
});

describe('findMatchInvariantViolations — single corruptions', () => {
  function lobbyMatch(): MatchState {
    return createMatchState({
      matchId: 'match-invariants',
      players: [
        { id: 'alpha', name: 'alpha' },
        { id: 'bravo', name: 'bravo' },
      ],
    });
  }

  function matchAfterOneRound(): MatchState {
    const { match, round } = endedRoundByElimination();
    return applyRoundResult(match, round).match;
  }

  function matchAtMatchEnd(): MatchState {
    const afterOne = matchAfterOneRound();
    const afterTwo = applyRoundResult(afterOne, curateEndedRound(afterOne, 'alpha')).match;
    return applyRoundResult(afterTwo, curateEndedRound(afterTwo, 'alpha')).match;
  }

  it('flags a roster below two players', () => {
    const match = cloneMatch(matchAfterOneRound());
    match.players.pop();
    expectMatchViolation(match, 'MATCH_ROSTER');
  });

  it('flags a roster above six players', () => {
    const sixPlayerMatch = createMatchState({
      matchId: 'match-invariants',
      players: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, name: id })),
    });
    expect(findMatchInvariantViolations(sixPlayerMatch)).toEqual([]);
    const match = cloneMatch(sixPlayerMatch);
    match.players.push({
      id: 'zulu',
      name: 'zulu',
      connected: true,
      eliminated: false,
      protected: false,
      hand: [],
      discards: [],
      victoryTokens: 0,
    });
    expectMatchViolation(match, 'MATCH_ROSTER');
  });

  it('flags duplicated player ids', () => {
    const match = cloneMatch(lobbyMatch());
    match.players[1]!.id = 'alpha';
    expectMatchViolation(match, 'MATCH_ROSTER');
  });

  it('flags a negative victory token count', () => {
    const match = cloneMatch(matchAfterOneRound());
    match.players[0]!.victoryTokens = -1;
    expectMatchViolation(match, 'MATCH_TOKENS');
  });

  it('flags a fractional victory token count', () => {
    const match = cloneMatch(matchAfterOneRound());
    match.players[0]!.victoryTokens = 1.5;
    expectMatchViolation(match, 'MATCH_TOKENS');
  });

  it('flags an unknown match status', () => {
    const match = cloneMatch(lobbyMatch());
    (match as { status: string }).status = 'PAUSED';
    expectMatchViolation(match, 'MATCH_STATUS');
  });

  it('flags MATCH_END without winners', () => {
    const match = cloneMatch(matchAtMatchEnd());
    match.winners = [];
    expectMatchViolation(match, 'MATCH_WINNERS');
  });

  it('flags duplicated match winners', () => {
    const match = cloneMatch(matchAtMatchEnd());
    match.winners = ['alpha', 'alpha'];
    expectMatchViolation(match, 'MATCH_WINNERS');
  });

  it('flags a match winner outside the roster', () => {
    const match = cloneMatch(matchAtMatchEnd());
    match.winners = ['ghost'];
    expectMatchViolation(match, 'MATCH_WINNERS');
  });

  it('flags a match winner below the victory threshold', () => {
    const match = cloneMatch(matchAtMatchEnd());
    match.winners = ['bravo'];
    expectMatchViolation(match, 'MATCH_WINNERS');
  });

  it('flags winners declared on a non-ended match', () => {
    const match = cloneMatch(lobbyMatch());
    match.winners = ['alpha'];
    expectMatchViolation(match, 'MATCH_WINNERS');
  });

  it('flags a shared MATCH_END that omits a qualifying co-winner', () => {
    const match = cloneMatch(matchAtSharedMatchEnd());
    expect(match.status).toBe('MATCH_END');
    match.winners = ['alpha'];
    expectMatchViolation(match, 'MATCH_WINNERS');
    const violations = findMatchInvariantViolations(match);
    expect(
      violations.some(
        (violation) =>
          violation.code === 'MATCH_WINNERS' &&
          violation.detail.includes('bravo') &&
          violation.detail.includes('threshold'),
      ),
    ).toBe(true);
  });

  it('flags a non-object match state without throwing', () => {
    const violations = findMatchInvariantViolations(null as unknown as MatchState);
    expect(violations.map((violation) => violation.code)).toContain('MATCH_ROSTER');
  });
});

describe('assertMatchInvariants', () => {
  it('does not throw on a clean match', () => {
    const match = createMatchState({
      matchId: 'match-invariants',
      players: [
        { id: 'alpha', name: 'alpha' },
        { id: 'bravo', name: 'bravo' },
      ],
    });
    expect(() => assertMatchInvariants(match)).not.toThrow();
  });

  it('throws the typed error aggregating violations of a corrupted match', () => {
    const match = createMatchState({
      matchId: 'match-invariants',
      players: [
        { id: 'alpha', name: 'alpha' },
        { id: 'bravo', name: 'bravo' },
      ],
    });
    match.players[0]!.victoryTokens = -1;
    expect(() => assertMatchInvariants(match)).toThrow(InvariantViolationError);
  });
});
