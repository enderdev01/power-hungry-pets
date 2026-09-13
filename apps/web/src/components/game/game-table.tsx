'use client';

/**
 * M7 game table (WU6-WU9 slice). It renders authoritative projections and
 * configurable visual placeholders, plus the server-gated turn controls:
 * Draw renders exactly when the viewer's own legalActions carry DRAW_CARD,
 * Play renders per exact targetless PLAY_CARD action, and target-bearing
 * plays arm inline target choices derived only from the published target
 * options. Control rendering is derived by the pure turn-controls selector;
 * this component never infers legality from phase, hand, or turn order,
 * never mutates game state, and final M8 art stays outside it.
 */
import { useEffect, useRef, useState } from 'react';
import { CardPlaceholder } from '@/components/game/card-placeholder';
import { PrivateDecisionModal } from '@/components/game/private-decision-modal';
import type { CardAssetConfig } from '@/lib/game/asset-resolver';
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
import {
  advanceMotionConsumer,
  discardMotionForPlayer,
  discardOriginLabel,
  handMotionForPlayer,
  initialMotionConsumerState,
  tableShuffleMotion,
  zoneMotionForPlayer,
  type ActiveMotion,
  type DiscardMotion,
  type MotionConsumerState,
  type ZoneMotion,
} from '@/lib/game/presentation-motion';
import type { RoomFlowController } from '@/lib/room-flow/room-flow';
import type { RoomFlowState } from '@/lib/room-flow/reducer';
import type { PublicGameView, PublicPlayerView } from '@power-hungry-pets/protocol';

function playerNameById(view: PublicGameView, playerId: string): string | null {
  return view.players.find((player) => player.id === playerId)?.name ?? null;
}

function handCountLabel(count: number): string {
  return count === 1 ? '1 face-down card' : `${count} face-down cards`;
}

function tokenLabel(count: number): string {
  return count === 1 ? '1 victory token' : `${count} victory tokens`;
}

/** "Ana and Bruno" / "Ana, Bruno and Caro" for shared-win wording. */
function joinNames(names: string[]): string {
  if (names.length <= 2) {
    return names.join(' and ');
  }
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** WU9 slip title: honest about a round number the evidence never carried. */
function roundResultTitle(roundNumber: number | null): string {
  return roundNumber === null ? 'The round is over' : `Round ${roundNumber} is over`;
}

function roundResultWinnersSentence(model: RoundResultModel): string | null {
  if (model.kind !== 'visible' || model.winners.length === 0) {
    return null;
  }
  const names = model.winners.map((winner) => winner.name);
  return model.sharedWin ? `${joinNames(names)} share the round.` : `${names[0]} wins the round.`;
}

/** WU10 match sentence: resolved visible winners only, never a raw id. */
function matchResultWinnersSentence(model: MatchResultModel): string | null {
  if (model.kind !== 'visible' || model.winners.length === 0) {
    return null;
  }
  const names = model.winners.map((winner) => winner.name);
  return model.sharedWin ? `${joinNames(names)} share the match.` : `${names[0]} wins the match.`;
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
    ? `${award.name} earned ${tokens}.`
    : `${award.name} earned ${tokens} — now ${award.total}.`;
}

function turnPrompt(view: PublicGameView, viewerId: string | null): string {
  const round = view.round;
  if (round === null) return 'No live round — waiting for the server.';

  const action = round.phase === 'DRAW_REQUIRED' ? 'draw a card' : 'play a card';
  if (round.currentPlayerId === viewerId) return `YOUR TURN — ${action}.`;

  const currentName = playerNameById(view, round.currentPlayerId);
  return currentName === null
    ? 'The round is between turns.'
    : `Waiting for ${currentName} to ${action}`;
}

function pendingPrompt(view: PublicGameView): string | null {
  const pending = view.round?.pendingInteraction;
  if (pending === null || pending === undefined) return null;

  const actor = playerNameById(view, pending.actorId) ?? 'A player';
  const decision: Record<typeof pending.type, string> = {
    PECERA_TARGET: 'is choosing a target',
    PECERA_GUESS: 'is making a private guess',
    RATON_INSERT_POSITION: 'is resolving Ratón Trampero',
    SAQUEADOG_SWAP: 'is making a private swap decision',
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
  discardMotion?: DiscardMotion | null;
  /**
   * Sequence of an active table-level shuffle cue; remounts only the face-down
   * backs so the gather replays once per batch without touching the controls.
   */
  shuffleSequence?: number;
}

/** Public-only player zone: opponent card identities never enter this component. */
function PlayerZone({
  player,
  assetConfig,
  targetChoice,
  zoneMotion,
  handMotion,
  discardMotion,
  shuffleSequence,
}: PlayerZoneProps) {
  return (
    <li
      className="game-player-zone"
      data-player-id={player.id}
      data-eliminated={player.eliminated}
      data-protected={player.protected}
      data-motion={zoneMotion?.kind}
      data-motion-sequence={zoneMotion?.sequence}
    >
      <header className="game-player-header">
        <strong>{player.name}</strong>
        <span>{player.connected ? 'at the table' : 'away'}</span>
      </header>
      <p>{tokenLabel(player.victoryTokens)}</p>
      <div className="game-status-list" role="group" aria-label={`${player.name} status`}>
        {player.protected && <span>protected</span>}
        {player.eliminated && <span>eliminated</span>}
      </div>
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
            label={`Face-down card ${index + 1}`}
          />
        ))}
      </div>
      {targetChoice !== undefined && (
        <div className="game-target-controls">
          <button
            type="button"
            className="action-button game-target-button"
            disabled={targetChoice.disabled}
            onClick={() => targetChoice.onChoose(player.id)}
          >
            {`Play ${targetChoice.cardName} on ${player.name}`}
          </button>
        </div>
      )}
      {player.discards.length > 0 && (
        <div
          key={
            discardMotion !== null && discardMotion !== undefined
              ? `discards-m${discardMotion.sequence}`
              : 'discards'
          }
          className="game-discards"
          role="group"
          aria-label={`${player.name} public discards`}
          data-motion={discardMotion?.kind}
          data-motion-sequence={discardMotion?.sequence}
        >
          <p className="game-discard-count">
            {player.discards.length === 1
              ? '1 card in the pile'
              : `${player.discards.length} cards in the pile`}
          </p>
          {player.discards.map((discard, index) => (
            <CardPlaceholder
              key={index}
              card={discard.card}
              assetConfig={assetConfig}
              originLabel={discardOriginLabel(discard.origin) ?? undefined}
              label={`${discard.card.value} card in ${player.name}'s public discard pile`}
            />
          ))}
        </div>
      )}
    </li>
  );
}

interface GameTableProps {
  /** Room-flow controller the turn controls call; the server decides legality. */
  controller: RoomFlowController;
  state: RoomFlowState;
  /** Optional M8 asset mapping; M7 intentionally supplies none. */
  assetConfig?: CardAssetConfig;
}

export function GameTable({ controller, state, assetConfig }: GameTableProps) {
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
  useEffect(() => {
    const { state: consumer, plan } = advanceMotionConsumer(
      motionConsumerRef.current,
      game.motionCue,
      publicView,
    );
    motionConsumerRef.current = consumer;
    setActiveMotion(plan);
  }, [game.motionCue, publicView]);
  // The only legality source this table ever consults: the viewer's exact
  // authoritative legalActions, screened by the pure selector.
  const controls = evaluateTurnControls(privateView, viewerId);
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
  const [dismissedResult, setDismissedResult] = useState<RoundResultEvidence | null>(null);
  // A WU8 mandatory modal owns the interaction while it is open: the slip is
  // hidden (not discarded) so its Continue is never visible-but-inert behind
  // the modal. When the modal closes, the slip returns if the evidence remains.
  const resultVisible =
    !decisionOpen && game.roundResult !== null && game.roundResult !== dismissedResult;
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
        <section className="game-match-result" role="status" aria-label="Match result">
          <h1 className="game-match-result-title">The match is over</h1>
          {matchWinnersSentence !== null ? (
            <p className="game-match-result-winners">{matchWinnersSentence}</p>
          ) : (
            <p className="game-match-result-winners">No winner was announced.</p>
          )}
          <div className="game-match-result-totals">
            <h2>Final score</h2>
            <ul>
              {matchResult.totals.map((total) => (
                <li key={total.playerId}>{`${total.name}: ${tokenLabel(total.tokens)}`}</li>
              ))}
            </ul>
          </div>
          <p className="game-match-result-note">
            No rematch is available — a new game starts with a new room.
          </p>
        </section>
        {decisionOpen && (
          <PrivateDecisionModal
            decision={decision}
            hand={ownHand}
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
        The table is being prepared — waiting for the server’s first projection.
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

  return (
    <>
      <div
        ref={tableRef}
        className="game-table"
        data-visual-system="m7-placeholders"
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
                Try again
              </button>
            )}
          </section>
        )}

        <header className="game-table-heading">
          <h1>Round {round?.roundNumber ?? publicView.match.roundNumber}</h1>
          <p className="game-turn" role="status">
            {turnPrompt(publicView, viewerId)}
          </p>
          {pending !== null && <p className="game-pending">{pending}</p>}
        </header>

        <section className="game-center" aria-label="Shared card area">
          <div className="game-pile" data-token-role="draw-pile">
            <h2>Draw pile</h2>
            <CardPlaceholder faceDown label="Draw pile, face down" />
            <p>{round?.drawPileCount ?? 0} cards</p>
            {controls.drawAllowed && (
              <button
                type="button"
                className="action-button"
                disabled={busy !== null}
                onClick={() => {
                  void controller.drawCard();
                }}
              >
                {busy === 'draw' ? 'Drawing…' : 'Draw a card'}
              </button>
            )}
          </div>
          <div className="game-pile" data-token-role="hidden-card">
            <h2>Hidden card</h2>
            {(round?.hiddenCardCount ?? 0) > 0 ? (
              <CardPlaceholder faceDown label="Hidden card, face down" />
            ) : (
              <span className="game-empty-slot">No hidden card</span>
            )}
            <p>{round?.hiddenCardCount ?? 0} face down</p>
          </div>
        </section>

        <section
          className="game-players"
          aria-label="Players at the table"
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
                  discardMotion={discardMotionForPlayer(activeMotion, player.id)}
                  shuffleSequence={shuffleMotion?.sequence}
                />
              );
            })}
          </ul>
        </section>

        <section className="game-own-hand" aria-label="Your hand">
          <h2>Your hand</h2>
          {ownHand === null ? (
            <p data-hand-ready="false">Your hand has not arrived yet.</p>
          ) : ownHand.length === 0 ? (
            <p data-hand-ready="true">Your hand is empty right now.</p>
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
                  >
                    <CardPlaceholder card={card} showEffect assetConfig={assetConfig} />
                    {playable && (
                      <button
                        type="button"
                        className="action-button game-play-button"
                        disabled={busy !== null}
                        onClick={() => {
                          void controller.playCard(card.instanceId);
                        }}
                      >
                        {busy === 'play' ? 'Playing…' : `Play ${presentation.name}`}
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
                        {busy === 'play' ? 'Playing…' : `Play ${presentation.name}`}
                      </button>
                    )}
                    {armedHere && (
                      <>
                        <p className="game-armed-prompt" role="status">
                          {`Choose a target for ${presentation.name}.`}
                        </p>
                        <button
                          type="button"
                          className="action-button game-play-button"
                          disabled={busy !== null}
                          ref={cancelButtonRef}
                          onClick={cancelTargetSelection}
                        >
                          Cancel target
                        </button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* WU9: the centered pinned-paper result slip. It stays inside the
            table (never a fixed overlay): the next round remains playable
            behind and around it, and table controls keep working. Hidden —
            not discarded — while a WU8 mandatory modal is open. */}
        {resultVisible && resultModel.kind === 'visible' && (
          <section className="game-round-result" role="status" aria-label="Round result">
            <h2 className="game-round-result-title">{roundResultTitle(resultModel.roundNumber)}</h2>
            {winnersSentence !== null && (
              <p className="game-round-result-winners">{winnersSentence}</p>
            )}
            <p className="game-round-result-reason">
              {roundResultReasonSentence(resultModel.reason)}
            </p>
            {resultModel.awards.length > 0 && (
              <div className="game-round-result-awards">
                <h3>Victory tokens</h3>
                <ul>
                  {resultModel.awards.map((award) => (
                    <li key={award.playerId}>{roundResultAwardSentence(award)}</li>
                  ))}
                </ul>
              </div>
            )}
            {resultModel.reveals.length > 0 && (
              <div className="game-round-result-reveals">
                <h3>Revealed hands</h3>
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
                        label={`${reveal.name}'s revealed hand: ${cardPresentation(reveal.card).name}, value ${reveal.card.value}`}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <button
              type="button"
              className="action-button game-round-result-continue"
              onClick={dismissResult}
            >
              Continue
            </button>
          </section>
        )}
      </div>

      {decisionOpen && (
        <PrivateDecisionModal
          decision={decision}
          hand={ownHand}
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
