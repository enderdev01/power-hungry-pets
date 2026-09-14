'use client';

/**
 * M8 game table (WU6-WU9 slice). It renders authoritative projections and
 * configurable visual placeholders, plus the server-gated turn controls:
 * Draw renders exactly when the viewer's own legalActions carry DRAW_CARD,
 * Play renders per exact targetless PLAY_CARD action, and target-bearing
 * plays arm inline target choices derived only from the published target
 * options. Control rendering is derived by the pure turn-controls selector;
 * this component never infers legality from phase, hand, or turn order,
 * never mutates game state, and final M8 art stays outside it.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flyFrom, rectOf } from '@/components/game/card-flight';
import { CardPlaceholder } from '@/components/game/card-placeholder';
import { PrivateDecisionModal } from '@/components/game/private-decision-modal';
import { PlayerAvatar } from '@/components/game/player-avatar';
import type { CardAssetConfig } from '@/lib/game/asset-resolver';
import { resolveCardArt } from '@/lib/game/asset-resolver';
import { RESULT_DEFEAT_ART_KEY, RESULT_VICTORY_ART_KEY } from '@/lib/game/card-assets';
import { cardPresentation } from '@/lib/game/card-presentation';
import { evaluateMatchResult, type MatchResultModel } from '@/lib/game/match-result';
import { evaluatePendingDecision } from '@/lib/game/pending-decision';
import {
  evaluateRoundResult,
  roundResultReasonSentence,
  type RoundResultEvidence,
  type RoundResultModel,
} from '@/lib/game/round-result';
import { evaluateTurnControls } from '@/lib/game/turn-controls';
import { PlayerTokenRack, tokenLabel } from '@/components/game/player-token-rack';
import {
  advanceMotionConsumer,
  discardMotionForPlayer,
  discardOriginLabel,
  handMotionForPlayer,
  initialMotionConsumerState,
  protectionMotionForPlayer,
  tableShuffleMotion,
  tokenMotionForPlayer,
  zoneMotionForPlayer,
  type ActiveMotion,
  type MotionConsumerState,
  type StatusMotionKind,
  type StatusPlan,
  type ZoneMotion,
} from '@/lib/game/presentation-motion';
import { announcementForBatch, type TableAnnouncement } from '@/lib/game/table-announcement';
import {
  nextPileOrder,
  pileCards,
  pileTilt,
  seatSlots,
  type PileKey,
  type SeatSlot,
} from '@/lib/game/table-layout';
import type { RoomFlowController } from '@/lib/room-flow/room-flow';
import type { RoomFlowState } from '@/lib/room-flow/reducer';
import type { PublicCard, PublicGameView, PublicPlayerView } from '@power-hungry-pets/protocol';

function playerNameById(view: PublicGameView, playerId: string): string | null {
  return view.players.find((player) => player.id === playerId)?.name ?? null;
}

interface ResultPresetProps {
  outcome: 'victory' | 'defeat';
  headline: string;
  detail: string;
  assetConfig?: CardAssetConfig;
}

/**
 * Per-player result card: the victory or defeat preset art with this
 * viewer's own outcome written in the art's blank panel. Decorative: the
 * surrounding result surface carries the full accessible text.
 */
function ResultPreset({ outcome, headline, detail, assetConfig }: ResultPresetProps) {
  const art = resolveCardArt(
    outcome === 'victory' ? RESULT_VICTORY_ART_KEY : RESULT_DEFEAT_ART_KEY,
    assetConfig,
  );
  if (art.kind !== 'image') {
    return null;
  }
  return (
    <figure className="game-result-preset" data-outcome={outcome} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="game-result-preset-art" src={art.src} alt="" draggable={false} />
      <figcaption className="game-result-preset-text">
        <strong>{headline}</strong>
        <span>{detail}</span>
      </figcaption>
    </figure>
  );
}

/** Visual deck thickness bucket from the public draw-pile count. */
function deckStackLevel(count: number): 'empty' | 'low' | 'mid' | 'high' {
  if (count <= 0) return 'empty';
  if (count <= 4) return 'low';
  if (count <= 10) return 'mid';
  return 'high';
}

/** How many of the newest pile cards are drawn; older ones are covered. */
const PILE_VISIBLE_LIMIT = 8;

function handCountLabel(count: number): string {
  return count === 1 ? '1 carta boca abajo' : `${count} cartas boca abajo`;
}

/** "Ana y Bruno" / "Ana, Bruno y Caro" for shared-win wording. */
function joinNames(names: string[]): string {
  if (names.length <= 2) {
    return names.join(' y ');
  }
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

/** WU9 slip title: honest about a round number the evidence never carried. */
function roundResultTitle(roundNumber: number | null): string {
  return roundNumber === null ? 'La ronda terminó' : `Terminó la ronda ${roundNumber}`;
}

function roundResultWinnersSentence(model: RoundResultModel): string | null {
  if (model.kind !== 'visible' || model.winners.length === 0) {
    return null;
  }
  const names = model.winners.map((winner) => winner.name);
  return model.sharedWin
    ? `${joinNames(names)} comparten la victoria de la ronda.`
    : `${names[0]} gana la ronda.`;
}

/** WU10 match sentence: resolved visible winners only, never a raw id. */
function matchResultWinnersSentence(model: MatchResultModel): string | null {
  if (model.kind !== 'visible' || model.winners.length === 0) {
    return null;
  }
  const names = model.winners.map((winner) => winner.name);
  return model.sharedWin
    ? `${joinNames(names)} comparten la victoria de la partida.`
    : `${names[0]} gana la partida.`;
}

function roundResultAwardSentence(award: {
  name: string;
  amount: number;
  total: number | null;
}): string {
  // Award-only copy when the total is withheld: it can only claim what the
  // evidence announced, never a possibly stale pre-award balance.
  const tokens = tokenLabel(award.amount);
  return award.total === null
    ? `${award.name} obtuvo ${tokens}.`
    : `${award.name} obtuvo ${tokens} — ahora tiene ${award.total}.`;
}

function turnPrompt(view: PublicGameView, viewerId: string | null): string {
  const round = view.round;
  if (round === null) return 'No hay una ronda activa. Esperando al servidor.';

  const drawing = round.phase === 'DRAW_REQUIRED';
  if (round.currentPlayerId === viewerId) {
    return drawing ? 'TU TURNO — robá una carta.' : 'TU TURNO — jugá una carta.';
  }

  const currentName = playerNameById(view, round.currentPlayerId);
  if (currentName === null) {
    return 'La ronda está cambiando de turno.';
  }
  return drawing
    ? `Esperando a que ${currentName} robe una carta.`
    : `Esperando a que ${currentName} juegue una carta.`;
}

function pendingPrompt(view: PublicGameView): string | null {
  const pending = view.round?.pendingInteraction;
  if (pending === null || pending === undefined) return null;

  const actor = playerNameById(view, pending.actorId) ?? 'Un jugador';
  const decision: Record<typeof pending.type, string> = {
    PECERA_TARGET: 'está eligiendo un objetivo',
    PECERA_GUESS: 'está haciendo una apuesta privada',
    RATON_INSERT_POSITION: 'está resolviendo Ratón Trampero',
    SAQUEADOG_SWAP: 'está tomando una decisión privada de intercambio',
  };
  return `${actor} ${decision[pending.type]}.`;
}

interface PlayerZoneProps {
  player: PublicPlayerView;
  assetConfig?: CardAssetConfig;
  /**
   * Inline target choice for the viewer's armed play, rendered only for
   * players the server published as legal targets. Display names only.
   */
  targetChoice?: {
    cardName: string;
    disabled: boolean;
    onChoose: (targetId: string) => void;
  };
  /**
   * M8 one-shot motion cues, pre-resolved for this player by the pure
   * presentation-motion mapping. `null` renders no motion attribute at all.
   * Zone-level cues are attributed on the zone but animate only its
   * non-interactive hand surface: the zone subtree hosts the target
   * controls and never remounts for motion.
   */
  zoneMotion?: ZoneMotion | null;
  handMotion?: ZoneMotion | null;
  /**
   * Sequence of an active table-level shuffle cue; remounts only the face-down
   * backs so the gather replays once per batch without touching the controls.
   */
  shuffleSequence?: number;
  /**
   * M8 one-shot status cues for this player's persistent states, resolved by
   * the presentation-motion seam. The protection cue (settle or expiry) mounts
   * a keyed non-interactive pulse layer on the always-rendered status list — a
   * stable visible destination that stays perceivable even after an expiry
   * removes the badge — and the token cue marks the keyed pulse inside the
   * non-interactive token rack: neither ever remounts or animates the
   * interactive zone subtree that hosts the target controls.
   */
  statusMotion?: { kind: StatusMotionKind; sequence: number } | null;
  tokenMotion?: { kind: StatusMotionKind; sequence: number } | null;
  /** The projection's current player: presentation-only turn marker. */
  currentTurn?: boolean;
  /** The viewer's own seat. */
  isSelf?: boolean;
  /** Named by the visible round/match result evidence as a winner. */
  winner?: boolean;
  /** Presentation-only position around the table. */
  slot?: SeatSlot;
  /** A hand card the server revealed publicly at round end (exhaustion). */
  revealedCard?: PublicCard | null;
}

/** Public-only player zone: opponent card identities never enter this component. */
function PlayerZone({
  player,
  assetConfig,
  targetChoice,
  zoneMotion,
  handMotion,
  shuffleSequence,
  statusMotion,
  tokenMotion,
  currentTurn = false,
  isSelf = false,
  winner = false,
  slot,
  revealedCard = null,
}: PlayerZoneProps) {
  return (
    <li
      className="game-player-zone"
      data-player-id={player.id}
      data-eliminated={player.eliminated}
      data-protected={player.protected}
      data-connected={player.connected}
      data-current-turn={currentTurn ? 'true' : undefined}
      data-self={isSelf ? 'true' : undefined}
      data-winner={winner ? 'true' : undefined}
      data-legal-target={targetChoice !== undefined ? 'true' : undefined}
      data-seat-slot={slot}
      data-revealed={revealedCard !== null ? 'true' : undefined}
      data-motion={zoneMotion?.kind}
      data-motion-sequence={zoneMotion?.sequence}
    >
      <header className="game-player-header">
        {/* M8 seat avatar: derived from the display name only — initials
            plus a deterministic stamp variant — never a raw id. */}
        <span className="game-player-identity">
          <PlayerAvatar name={player.name} />
          <strong className="game-player-name">{player.name}</strong>
          {isSelf && <span className="game-player-self-tag">vos</span>}
        </span>
        {/* Public hand count, UNO-style; the hand group below announces it. */}
        <span className="game-seat-count" aria-hidden="true">
          {player.handCount}
        </span>
        <span className="game-player-presence" data-connected={player.connected}>
          {player.connected ? 'en la mesa' : 'ausente'}
        </span>
      </header>
      {/* The committed token count is the projection's own value, printed
          on the rack — never an optimistic increment. */}
      <PlayerTokenRack
        name={player.name}
        count={player.victoryTokens}
        motion={tokenMotion ?? null}
      />
      <div className="game-status-list" role="group" aria-label={`Estado de ${player.name}`}>
        {/* The keyed non-interactive pulse layer: the one-shot cue mounts a
            sequence-stamped visual child on this always-rendered status
            surface, so an expiry stays perceivable after the badge is gone
            (persistent text still comes only from the projection) and a
            consecutive same-kind cue retriggers by remounting only this layer —
            never the interactive zone subtree. */}
        {statusMotion !== null && statusMotion !== undefined && (
          <span
            key={`status-pulse-${statusMotion.sequence}`}
            className="game-status-pulse"
            data-motion={statusMotion.kind}
            data-motion-sequence={statusMotion.sequence}
            aria-hidden="true"
          />
        )}
        {/* The persistent states render only from the projection: a pinned
            badge with a text-bearing marker, never a color-only switch. The
            one-shot cue is a moment, never a state, so an expiry or reconnect
            can never leave a false persistent marker. */}
        {currentTurn && !player.eliminated && (
          <span className="game-status-badge" data-state="turn">
            <span className="game-status-icon" aria-hidden="true" />
            turno
          </span>
        )}
        {winner && (
          <span className="game-status-badge" data-state="winner">
            <span className="game-status-icon" aria-hidden="true" />
            ganó
          </span>
        )}
        {player.protected && (
          <span className="game-status-badge" data-state="protected">
            <span className="game-status-pin game-status-icon" aria-hidden="true" />
            protegido
          </span>
        )}
        {player.eliminated && (
          <span className="game-status-badge" data-state="eliminated">
            <span className="game-status-icon" aria-hidden="true" />
            eliminado
          </span>
        )}
      </div>
      {revealedCard !== null && (
        // The publicly revealed hand card turns face up where the hand is.
        <div className="game-seat-reveal">
          <CardPlaceholder
            card={revealedCard}
            assetConfig={assetConfig}
            label={`Carta revelada de ${player.name}: ${cardPresentation(revealedCard).name}`}
          />
        </div>
      )}
      <div
        // One-shot cue replay keys the non-interactive hand surface only:
        // a draw settle, exchange, or actor settle remounts the face-down
        // backs, never the zone subtree that hosts the target controls.
        key={
          handMotion !== null && handMotion !== undefined
            ? `hand-m${handMotion.sequence}`
            : zoneMotion !== null && zoneMotion !== undefined
              ? `hand-z${zoneMotion.sequence}`
              : 'hand'
        }
        className="game-opponent-hand"
        role="group"
        aria-label={handCountLabel(player.handCount)}
        data-motion={handMotion?.kind}
        data-motion-sequence={handMotion?.sequence}
      >
        {Array.from({ length: player.handCount }, (_, index) => (
          <CardPlaceholder
            key={shuffleSequence !== undefined ? `back-${index}-s${shuffleSequence}` : index}
            faceDown
            assetConfig={assetConfig}
            label={`Carta boca abajo ${index + 1}`}
          />
        ))}
      </div>
    </li>
  );
}

interface GameTableProps {
  /** Room-flow controller the turn controls call; the server decides legality. */
  controller: RoomFlowController;
  state: RoomFlowState;
  /** Optional M8 asset mapping; M7 intentionally supplies none. */
  assetConfig?: CardAssetConfig;
  /**
   * Sends the mandatory draw as soon as the server publishes DRAW_CARD for
   * the viewer. Legality still comes only from the viewer's legalActions;
   * this only removes the manual click. Opt-in from the composition root.
   */
  autoDraw?: boolean;
}

export function GameTable({ controller, state, assetConfig, autoDraw = false }: GameTableProps) {
  const { game, self } = state;
  const publicView = game.publicView;
  const privateView = game.privateView;
  const viewerId = self?.playerId ?? null;
  const ownHand =
    privateView !== null && privateView.viewerId === viewerId ? privateView.hand : null;
  const busy = state.busy;
  // M8 card-action motion: the reducer-owned cue state is the only motion
  // source. The consumer cursor lives in a ref so projection-only renders can
  // never replay a consumed batch, and each batch resolves to at most one
  // authoritative destination cue once the projection confirms it.
  const motionConsumerRef = useRef<MotionConsumerState>(initialMotionConsumerState());
  const [activeMotion, setActiveMotion] = useState<ActiveMotion | null>(null);
  // The independent status channel (protection, token awards) resolves from
  // the same reducer-owned cue batch, confirmed against the projection.
  const [activeStatus, setActiveStatus] = useState<StatusPlan | null>(null);
  useEffect(() => {
    const {
      state: consumer,
      plan,
      statusPlan,
    } = advanceMotionConsumer(motionConsumerRef.current, game.motionCue, publicView);
    motionConsumerRef.current = consumer;
    setActiveMotion(plan);
    setActiveStatus(statusPlan);
  }, [game.motionCue, publicView]);
  // The only legality source this table ever consults: the viewer's exact
  // authoritative legalActions, screened by the pure selector.
  const controls = evaluateTurnControls(privateView, viewerId);

  const [dismissedResult, setDismissedResult] = useState<RoundResultEvidence | null>(null);
  // Auto-draw: one attempt per published draw opportunity. A failed attempt
  // is not retried in a loop; the error slip offers the explicit retry.
  const autoDrawKeyRef = useRef<string | null>(null);
  const drawKey =
    controls.drawAllowed && publicView?.round
      ? `${publicView.round.roundNumber}:${publicView.round.drawPileCount}:${publicView.round.currentPlayerId}`
      : null;
  // The viewer reads the round result first: auto-draw waits for Continue.
  const resultPending = game.roundResult !== null && game.roundResult !== dismissedResult;
  useEffect(() => {
    if (!autoDraw || drawKey === null || busy !== null || resultPending) {
      return;
    }
    if (autoDrawKeyRef.current === drawKey) {
      return;
    }
    autoDrawKeyRef.current = drawKey;
    void controller.drawCard();
  }, [autoDraw, drawKey, busy, controller, resultPending]);

  // Shared discard pile arrival order (presentation only).
  const pileOrderRef = useRef<PileKey[]>([]);
  pileOrderRef.current = nextPileOrder(pileOrderRef.current, publicView);

  // Receive flip: own-hand cards that arrive after the table mounted flip
  // from the back to their face once. Initial and reconnect hands never flip.
  const seenHandIdsRef = useRef<Set<string> | null>(null);
  const [receivedIds, setReceivedIds] = useState<ReadonlySet<string>>(new Set());
  const handIdsKey = ownHand?.map((card) => card.instanceId).join('|') ?? null;
  useEffect(() => {
    const ids = handIdsKey === null || handIdsKey === '' ? [] : handIdsKey.split('|');
    if (seenHandIdsRef.current === null) {
      seenHandIdsRef.current = new Set(ids);
      return;
    }
    const fresh = ids.filter((id) => !seenHandIdsRef.current!.has(id));
    seenHandIdsRef.current = new Set(ids);
    if (fresh.length > 0) {
      setReceivedIds(new Set(fresh));
    }
  }, [handIdsKey]);

  // Measured flights (presentation only; skipped without Element.animate or
  // under reduced motion). The layout is already authoritative: flights only
  // offset elements visually from where the card came from.
  const deckRect = (): DOMRect | null =>
    rectOf(tableRef.current?.querySelector('[data-token-role="draw-pile"] .game-card-placeholder'));
  useLayoutEffect(() => {
    if (receivedIds.size === 0) {
      return;
    }
    const from = deckRect();
    tableRef.current
      ?.querySelectorAll<HTMLElement>('.game-hand-entry[data-received="true"] .game-hand-card')
      .forEach((card, index) => flyFrom(card, from, { flip: true, duration: 700 + index * 80 }));
  }, [receivedIds]);

  // Throws and opponent draws follow the confirmed motion plan's sequence.
  const flightSequence = activeMotion?.sequence ?? null;
  useLayoutEffect(() => {
    const table = tableRef.current;
    if (activeMotion === null || table === null) {
      return;
    }
    if (activeMotion.kind === 'card-landing' || activeMotion.kind === 'card-flip') {
      const slots = table.querySelectorAll<HTMLElement>(
        '[data-token-role="discard-pile"] .game-discard-slot',
      );
      const top = slots.item(slots.length - 1);
      const origin =
        activeMotion.playerId === viewerId
          ? table.querySelector('.game-hand-list')
          : table.querySelector(`.game-player-zone[data-player-id="${activeMotion.playerId}"]`);
      flyFrom(top, rectOf(origin), {
        flip: activeMotion.kind === 'card-flip',
        spin: activeMotion.playerId === viewerId ? -28 : 32,
        duration: 620,
      });
    } else if (activeMotion.kind === 'draw-settle' && activeMotion.playerId !== viewerId) {
      const back = table.querySelector<HTMLElement>(
        `.game-player-zone[data-player-id="${activeMotion.playerId}"] .game-opponent-hand .game-card-placeholder-back:last-child`,
      );
      flyFrom(back, deckRect(), { duration: 600 });
    }
    // Runs once per confirmed batch sequence.
  }, [flightSequence]);

  // Challenge announcements: only batches newer than the mount are announced,
  // so a reconnect never replays an old outcome.
  const announcedSequenceRef = useRef<number>(game.motionCue?.lastBatch?.sequence ?? 0);
  const [announcement, setAnnouncement] = useState<
    (TableAnnouncement & { sequence: number }) | null
  >(null);
  const lastBatch = game.motionCue?.lastBatch ?? null;
  useEffect(() => {
    if (lastBatch === null || lastBatch.sequence <= announcedSequenceRef.current) {
      return;
    }
    announcedSequenceRef.current = lastBatch.sequence;
    const next = announcementForBatch(lastBatch.cues, publicView, viewerId);
    if (next !== null) {
      setAnnouncement({ ...next, sequence: lastBatch.sequence });
    }
  }, [lastBatch, publicView, viewerId]);
  useEffect(() => {
    if (announcement === null) {
      return;
    }
    const timer = setTimeout(() => setAnnouncement(null), 2600);
    return () => clearTimeout(timer);
  }, [announcement]);
  // WU8: the mandatory private decision, derived only from the viewer-matched
  // private projection plus its exact legal actions. A `none` model renders no
  // modal; any other kind opens it over an inert table.
  const decision = evaluatePendingDecision(privateView, viewerId);
  const decisionOpen = decision.kind !== 'none';
  // WU9: the round result, derived only from the captured ROUND_ENDED
  // batch evidence plus the current public view — never inferred from
  // public state. It is information, not a mandatory decision: no modal,
  // no inert table, no focus trap. An explicit Continue dismisses it
  // locally and sends no game command; a newly captured batch arrives as
  // a fresh evidence object and re-arms the slip.
  const resultModel = evaluateRoundResult(game.roundResult, publicView);
  // WU10: match-over is derived only from the authoritative projection
  // (`publicView.match.status === 'MATCH_END'`); the live matchEnded/
  // matchWinners broadcast state is supplemental evidence at most, so a
  // reconnect after the finish renders the full result from the projection
  // alone. The dedicated centered surface replaces the playable table: the
  // server has no rematch contract, so no rematch action is offered.
  const matchResult = evaluateMatchResult(publicView, game.matchWinners);
  const matchWinnersSentence = matchResultWinnersSentence(matchResult);
  // A WU8 mandatory modal owns the interaction while it is open: the slip is
  // hidden (not discarded) so its Continue is never visible-but-inert behind
  // the modal. When the modal closes, the slip returns if the evidence remains.
  const resultVisible =
    !decisionOpen && game.roundResult !== null && game.roundResult !== dismissedResult;
  const continueRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (resultVisible) {
      continueRef.current?.focus();
    }
  }, [resultVisible, game.roundResult]);
  const dismissResult = (): void => {
    setDismissedResult(game.roundResult);
  };
  const winnersSentence = roundResultWinnersSentence(resultModel);
  // One local armed-card selection at a time. The selection self-heals against
  // new projections: an armed card that no longer carries published target
  // options (or became targetless-playable) is simply no longer armed.
  const [armedCardId, setArmedCardId] = useState<string | null>(null);
  const armedOptions =
    armedCardId !== null ? controls.targetOptionsByCardId[armedCardId] : undefined;
  const armedCard = ownHand?.find((card) => card.instanceId === armedCardId) ?? null;
  const armed =
    armedCardId !== null &&
    armedCard !== null &&
    armedOptions !== undefined &&
    armedOptions.length > 0 &&
    !controls.playableCardIds.includes(armedCardId)
      ? { card: armedCard, options: armedOptions, name: cardPresentation(armedCard).name }
      : null;

  // Focus continuity: arming unmounts the arm button and canceling unmounts the
  // armed controls. A ref-based effect keeps keyboard focus on a live control
  // instead of dropping it to <body>. The intent ref scopes every focus move to
  // an explicit arm/cancel click — never a projection self-heal — and the
  // last-armed ref re-attaches the arm-button ref during the cancel commit,
  // before the effect runs.
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const armButtonRef = useRef<HTMLButtonElement | null>(null);
  const tableRef = useRef<HTMLDivElement | null>(null);
  const focusIntentRef = useRef<'arm' | 'cancel' | null>(null);
  const lastArmedCardIdRef = useRef<string | null>(null);

  useEffect(() => {
    const intent = focusIntentRef.current;
    focusIntentRef.current = null;
    if (intent === 'cancel') {
      cancelButtonRef.current?.focus();
    } else if (intent === 'arm') {
      armButtonRef.current?.focus();
    }
    lastArmedCardIdRef.current = armedCardId;
  }, [armedCardId]);

  const armTargetSelection = (instanceId: string): void => {
    focusIntentRef.current = 'cancel';
    setArmedCardId(instanceId);
  };

  const cancelTargetSelection = (): void => {
    focusIntentRef.current = 'arm';
    setArmedCardId(null);
  };

  const chooseTarget = (targetId: string): void => {
    if (armed === null) {
      return;
    }
    setArmedCardId(null);
    void controller.playCard(armed.card.instanceId, targetId);
  };

  const targetChoiceFor = (playerId: string) => {
    if (armed === null) {
      return undefined;
    }
    const option = armed.options.find((candidate) => candidate.targetId === playerId);
    if (option === undefined) {
      return undefined;
    }
    return {
      cardName: armed.name,
      disabled: busy !== null,
      onChoose: chooseTarget,
    };
  };

  if (matchResult.kind === 'visible') {
    return (
      <>
        <section className="game-match-result" role="status" aria-label="Resultado de la partida">
          {viewerId !== null && matchResult.winners.length > 0 && (
            <ResultPreset
              outcome={
                matchResult.winners.some((winner) => winner.playerId === viewerId)
                  ? 'victory'
                  : 'defeat'
              }
              headline={
                matchResult.winners.some((winner) => winner.playerId === viewerId)
                  ? '¡Ganaste la partida!'
                  : `Ganó ${joinNames(matchResult.winners.map((winner) => winner.name))}`
              }
              detail={`Terminaste con ${
                matchResult.totals.find((total) => total.playerId === viewerId)?.tokens ?? 0
              } fichas`}
              assetConfig={assetConfig}
            />
          )}
          <h1 className="game-match-result-title">La partida terminó</h1>
          {matchWinnersSentence !== null ? (
            <p className="game-match-result-winners">{matchWinnersSentence}</p>
          ) : (
            <p className="game-match-result-winners">No se anunció un ganador.</p>
          )}
          <div className="game-match-result-totals">
            <h2>Puntaje final</h2>
            <ul>
              {matchResult.totals.map((total) => (
                <li key={total.playerId}>{`${total.name}: ${tokenLabel(total.tokens)}`}</li>
              ))}
            </ul>
          </div>
          <p className="game-match-result-note">
            Volvé al lobby para jugar otra partida con la misma mesa.
          </p>
          {self !== null && (
            <button
              type="button"
              className="action-button game-match-result-exit"
              disabled={busy !== null}
              onClick={() => {
                void controller.returnToLobby();
              }}
            >
              {busy === 'return-lobby' ? 'Volviendo…' : 'Volver al lobby'}
            </button>
          )}
        </section>
        {decisionOpen && (
          <PrivateDecisionModal
            decision={decision}
            hand={ownHand}
            assetConfig={assetConfig}
            busy={busy !== null}
            onChooseTarget={(targetId) => void controller.chooseTarget(targetId)}
            onSubmitGuess={(value) => void controller.submitGuess(value)}
            onChooseHiddenSwap={(swap) => void controller.chooseHiddenSwap(swap)}
            onChooseDeckPosition={(index) => void controller.chooseDeckPosition(index)}
          />
        )}
      </>
    );
  }

  if (publicView === null) {
    return (
      <section className="game-table-message" role="status">
        Preparando la mesa. Esperando la primera actualización del servidor.
      </section>
    );
  }

  // The actor's own decision is announced by the modal; the third-person pending
  // line would only duplicate it. Non-actors keep the public waiting copy.
  const pending = decisionOpen ? null : pendingPrompt(publicView);
  // M8: the table-level shuffle cue (HANDS_REDEALT carries no ids, so the
  // honest cue marks the shared players region, never a single seat).
  const shuffleMotion = tableShuffleMotion(activeMotion);
  const round = publicView.round;
  // Seat winner markers mirror only the visible result slip's own evidence.
  const resultWinnerIds = new Set(
    resultVisible && resultModel.kind === 'visible'
      ? resultModel.winners.map((winner) => winner.playerId)
      : [],
  );
  const slots = seatSlots(publicView, viewerId);
  // Public exhaustion reveals only (rules §7): a last-survivor round reveals
  // nothing, so no hand is ever shown that the server did not publish.
  const revealedByPlayer = new Map(
    resultVisible && resultModel.kind === 'visible'
      ? resultModel.reveals.map((reveal) => [reveal.playerId, reveal.card] as const)
      : [],
  );
  const pile = pileCards(pileOrderRef.current, publicView);
  // Any confirmed landing/flip addresses the shared pile's newest card.
  const discardPileMotion =
    activeMotion !== null &&
    (activeMotion.kind === 'card-landing' || activeMotion.kind === 'card-flip')
      ? discardMotionForPlayer(activeMotion, activeMotion.playerId)
      : null;

  return (
    <>
      <div
        ref={tableRef}
        className="game-table"
        data-visual-system="tabletop-arcade"
        data-targeting={armed !== null ? 'true' : undefined}
        tabIndex={-1}
        inert={decisionOpen ? true : undefined}
      >
        {/* While the modal is open the table is inert, so the error slip is
            mirrored inside the modal instead — one live alert, never two. */}
        {!decisionOpen && state.error !== null && (
          <section className="game-error" role="alert">
            <p className="game-error-sentence">{state.error.sentence}</p>
            {state.error.recovery === 'retry' && (
              <button
                type="button"
                className="action-button"
                onClick={() => {
                  void controller.retry();
                }}
              >
                Intentar de nuevo
              </button>
            )}
          </section>
        )}

        <header
          className="game-table-heading"
          data-your-turn={round !== null && round.currentPlayerId === viewerId ? 'true' : undefined}
        >
          <h1>Ronda {round?.roundNumber ?? publicView.match.roundNumber}</h1>
          <p className="game-turn" role="status">
            {turnPrompt(publicView, viewerId)}
          </p>
          {pending !== null && <p className="game-pending">{pending}</p>}
        </header>

        {announcement !== null && !resultVisible && (
          <div
            key={`announcement-${announcement.sequence}`}
            className="game-announcement"
            data-tone={announcement.tone}
            role="status"
          >
            <span className="game-announcement-face" aria-hidden="true" />
            <strong className="game-announcement-title">{announcement.title}</strong>
            <span className="game-announcement-detail">{announcement.detail}</span>
          </div>
        )}

        <section className="game-own-hand" aria-label="Tu mano">
          <h2>Tu mano</h2>
          {ownHand === null ? (
            <p data-hand-ready="false">Tu mano todavía no llegó.</p>
          ) : ownHand.length === 0 ? (
            <p data-hand-ready="true">Tu mano está vacía en este momento.</p>
          ) : (
            <ul className="game-hand-list" data-hand-ready="true">
              {ownHand.map((card) => {
                const playable = controls.playableCardIds.includes(card.instanceId);
                // Target-only cards arm inline target selection. A card whose
                // published targets all fail resolution maps to an empty list and
                // must never render an armable control (fail closed — no dead-end
                // arm).
                const needsTarget =
                  !playable && (controls.targetOptionsByCardId[card.instanceId]?.length ?? 0) > 0;
                const armedHere = armed !== null && armed.card.instanceId === card.instanceId;
                const presentation = cardPresentation(card);
                return (
                  <li
                    key={card.instanceId}
                    className="game-hand-entry"
                    data-armed={armedHere ? 'true' : undefined}
                    data-playable={playable || needsTarget ? 'true' : undefined}
                    data-received={receivedIds.has(card.instanceId) ? 'true' : undefined}
                  >
                    <span className="game-hand-card">
                      <CardPlaceholder card={card} showEffect assetConfig={assetConfig} />
                      {receivedIds.has(card.instanceId) && (
                        // The back half of the receive flip: decorative only.
                        <span className="game-hand-card-back" aria-hidden="true">
                          <CardPlaceholder faceDown assetConfig={assetConfig} label="" />
                        </span>
                      )}
                    </span>
                    {playable && (
                      <button
                        type="button"
                        className="action-button game-play-button"
                        disabled={busy !== null}
                        onClick={() => {
                          void controller.playCard(card.instanceId);
                        }}
                      >
                        {busy === 'play' ? 'Jugando…' : `Jugar ${presentation.name}`}
                      </button>
                    )}
                    {needsTarget && !armedHere && (
                      <button
                        type="button"
                        className="action-button game-play-button"
                        disabled={busy !== null}
                        ref={
                          card.instanceId === lastArmedCardIdRef.current ? armButtonRef : undefined
                        }
                        onClick={() => {
                          armTargetSelection(card.instanceId);
                        }}
                      >
                        {busy === 'play' ? 'Jugando…' : `Jugar ${presentation.name}`}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="game-center" aria-label="Zona de cartas compartida">
          <div
            className="game-pile"
            data-token-role="draw-pile"
            data-draw-ready={controls.drawAllowed ? 'true' : undefined}
            data-stack={deckStackLevel(round?.drawPileCount ?? 0)}
          >
            <h2>Mazo</h2>
            <CardPlaceholder faceDown assetConfig={assetConfig} label="Mazo boca abajo" />
            <p>{round?.drawPileCount ?? 0} cartas</p>
            {controls.drawAllowed && (!autoDraw || state.error?.action === 'draw') && (
              <button
                type="button"
                className="action-button"
                disabled={busy !== null}
                onClick={() => {
                  void controller.drawCard();
                }}
              >
                {busy === 'draw' ? 'Robando…' : 'Robar una carta'}
              </button>
            )}
            {controls.drawAllowed && autoDraw && busy === 'draw' && (
              <span className="game-pile-status" role="status">
                Robando…
              </span>
            )}
          </div>

          {/* The shared discard pile: every public discard face up, tossed with a
              slight deterministic tilt. Order is the client's arrival order,
              since the protocol publishes discards per player only. */}
          <div
            key={discardPileMotion !== null ? `pile-m${discardPileMotion.sequence}` : 'pile'}
            className="game-pile game-discards"
            data-token-role="discard-pile"
            role="group"
            aria-label="Pila de descartes"
            data-motion={discardPileMotion?.kind}
            data-motion-sequence={discardPileMotion?.sequence}
          >
            <p className="game-discard-count">
              {pile.length === 1 ? '1 carta en la pila' : `${pile.length} cartas en la pila`}
            </p>
            {pile.length === 0 && (
              <span className="game-empty-slot" aria-hidden="true">
                Descartes
              </span>
            )}
            {pile.slice(-PILE_VISIBLE_LIMIT).map((entry) => {
              const forced = entry.discard.origin === 'FORCED_PLAY';
              const tilt = pileTilt(entry.key);
              return (
                <div
                  key={entry.key}
                  className="game-discard-slot"
                  data-forced={forced ? 'true' : undefined}
                  style={
                    {
                      '--tilt': `${tilt.rotate}deg`,
                      '--shift-x': `${tilt.x}px`,
                      '--shift-y': `${tilt.y}px`,
                    } as React.CSSProperties
                  }
                >
                  {forced && <span className="game-discard-slot-pin" aria-hidden="true" />}
                  <CardPlaceholder
                    card={entry.discard.card}
                    assetConfig={assetConfig}
                    originLabel={discardOriginLabel(entry.discard.origin) ?? undefined}
                    label={`Carta ${entry.discard.card.value} jugada por ${entry.playerName}`}
                  />
                </div>
              );
            })}
          </div>

          <div className="game-pile" data-token-role="hidden-card">
            <h2>Carta oculta</h2>
            {(round?.hiddenCardCount ?? 0) > 0 ? (
              <CardPlaceholder faceDown assetConfig={assetConfig} label="Carta oculta boca abajo" />
            ) : (
              <span className="game-empty-slot">No hay carta oculta</span>
            )}
            <p>{round?.hiddenCardCount ?? 0} boca abajo</p>
          </div>
        </section>

        <section
          className="game-players"
          aria-label="Jugadores en la mesa"
          data-motion={shuffleMotion?.kind}
          data-motion-sequence={shuffleMotion?.sequence}
        >
          <ul className="game-player-list">
            {publicView.players.map((player) => {
              const zoneMotion = zoneMotionForPlayer(activeMotion, player.id);
              return (
                <PlayerZone
                  // The zone subtree never remounts for motion: it hosts
                  // keyboard-focusable target controls. The one-shot cue
                  // replays by remounting the non-interactive surfaces
                  // inside (hand backs, discard pile) keyed by sequence.
                  key={player.id}
                  player={player}
                  assetConfig={assetConfig}
                  targetChoice={targetChoiceFor(player.id)}
                  zoneMotion={zoneMotion}
                  handMotion={handMotionForPlayer(activeMotion, player.id)}
                  shuffleSequence={shuffleMotion?.sequence}
                  statusMotion={protectionMotionForPlayer(activeStatus, player.id)}
                  tokenMotion={tokenMotionForPlayer(activeStatus, player.id)}
                  currentTurn={round !== null && round.currentPlayerId === player.id}
                  isSelf={player.id === viewerId}
                  winner={resultWinnerIds.has(player.id)}
                  slot={slots[player.id]}
                  revealedCard={revealedByPlayer.get(player.id) ?? null}
                />
              );
            })}
          </ul>
        </section>

        {/* Target picker: the armed card's server-published legal targets, one
            button each. Not a mandatory decision — Cancel (or Escape) disarms. */}
        {armed !== null && (
          <div
            className="game-target-picker-overlay"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                cancelTargetSelection();
              }
            }}
          >
            <div
              className="game-target-picker"
              role="dialog"
              aria-modal="false"
              aria-labelledby="game-target-picker-title"
            >
              <p id="game-target-picker-title" className="game-armed-prompt" role="status">
                {`Elegí un objetivo para ${armed.name}.`}
              </p>
              <ul className="game-target-picker-list">
                {armed.options.map((option) => {
                  const target = publicView.players.find((player) => player.id === option.targetId);
                  if (target === undefined) {
                    return null;
                  }
                  return (
                    <li key={option.targetId}>
                      <button
                        type="button"
                        className="action-button game-target-button"
                        disabled={busy !== null}
                        onClick={() => chooseTarget(option.targetId)}
                      >
                        <span className="game-target-avatar" aria-hidden="true">
                          <PlayerAvatar name={target.name} />
                        </span>
                        <span>{`Jugar ${armed.name} contra ${target.name}`}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                className="action-button game-play-button game-target-picker-cancel"
                disabled={busy !== null}
                ref={cancelButtonRef}
                onClick={cancelTargetSelection}
              >
                Cancelar objetivo
              </button>
            </div>
          </div>
        )}

        {/* WU9: the centered pinned-paper result slip. It stays inside the
            table (never a fixed overlay): the next round remains playable
            behind and around it, and table controls keep working. Hidden —
            not discarded — while a WU8 mandatory modal is open. */}
        {resultVisible && resultModel.kind === 'visible' && (
          <section className="game-round-result" role="status" aria-label="Resultado de la ronda">
            {viewerId !== null && resultModel.winners.length > 0 && (
              <ResultPreset
                outcome={
                  resultModel.winners.some((winner) => winner.playerId === viewerId)
                    ? 'victory'
                    : 'defeat'
                }
                headline={
                  resultModel.winners.some((winner) => winner.playerId === viewerId)
                    ? '¡Ganaste la ronda!'
                    : `Ganó ${joinNames(resultModel.winners.map((winner) => winner.name))}`
                }
                detail={
                  resultModel.winners.some((winner) => winner.playerId === viewerId)
                    ? 'Sumás una ficha de victoria'
                    : 'La próxima es tuya'
                }
                assetConfig={assetConfig}
              />
            )}
            <h2 className="game-round-result-title">{roundResultTitle(resultModel.roundNumber)}</h2>
            {winnersSentence !== null && (
              <p className="game-round-result-winners">{winnersSentence}</p>
            )}
            <p className="game-round-result-reason">
              {roundResultReasonSentence(resultModel.reason)}
            </p>
            {resultModel.awards.length > 0 && (
              <div className="game-round-result-awards">
                <h3>Fichas de victoria</h3>
                <ul>
                  {resultModel.awards.map((award) => {
                    // One-shot token cue only on the award line the addressed
                    // public player earned; the printed total is the
                    // round-result model's committed value.
                    const awardMotion = tokenMotionForPlayer(activeStatus, award.playerId);
                    return (
                      <li
                        key={award.playerId}
                        data-motion={awardMotion?.kind}
                        data-motion-sequence={awardMotion?.sequence}
                      >
                        {roundResultAwardSentence(award)}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {resultModel.reveals.length > 0 && (
              <div className="game-round-result-reveals">
                <h3>Manos reveladas</h3>
                <ul className="game-round-result-reveals-list">
                  {resultModel.reveals.map((reveal, index) => (
                    <li key={`${reveal.playerId}-${index}-${resultModel.roundNumber ?? 'unknown'}`}>
                      <CardPlaceholder
                        card={reveal.card}
                        assetConfig={assetConfig}
                        motion={{
                          kind: 'card-flip',
                          sequence: resultModel.roundNumber ?? 'unknown',
                        }}
                        label={`Mano revelada de ${reveal.name}: ${cardPresentation(reveal.card).name}, valor ${reveal.card.value}`}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <button
              type="button"
              className="action-button game-round-result-continue"
              ref={continueRef}
              onClick={dismissResult}
            >
              Continuar
            </button>
          </section>
        )}
      </div>

      {decisionOpen && (
        <PrivateDecisionModal
          decision={decision}
          hand={ownHand}
          assetConfig={assetConfig}
          busy={busy !== null}
          restoreFocusRef={tableRef}
          error={state.error}
          onRetry={() => void controller.retry()}
          onChooseTarget={(targetId) => void controller.chooseTarget(targetId)}
          onSubmitGuess={(value) => void controller.submitGuess(value)}
          onChooseHiddenSwap={(swap) => void controller.chooseHiddenSwap(swap)}
          onChooseDeckPosition={(index) => void controller.chooseDeckPosition(index)}
        />
      )}
    </>
  );
}
