'use client';

/**
 * M7 game table (WU6/WU7 slice). It renders authoritative projections and
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
import type { CardAssetConfig } from '@/lib/game/asset-resolver';
import { cardPresentation } from '@/lib/game/card-presentation';
import { evaluateTurnControls } from '@/lib/game/turn-controls';
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
}

/** Public-only player zone: opponent card identities never enter this component. */
function PlayerZone({ player, assetConfig, targetChoice }: PlayerZoneProps) {
  return (
    <li
      className="game-player-zone"
      data-player-id={player.id}
      data-eliminated={player.eliminated}
      data-protected={player.protected}
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
        className="game-opponent-hand"
        role="group"
        aria-label={handCountLabel(player.handCount)}
      >
        {Array.from({ length: player.handCount }, (_, index) => (
          <CardPlaceholder key={index} faceDown label={`Face-down card ${index + 1}`} />
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
        <div className="game-discards" role="group" aria-label={`${player.name} public discards`}>
          {player.discards.map((discard, index) => (
            <CardPlaceholder
              key={index}
              card={discard.card}
              assetConfig={assetConfig}
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
  // The only legality source this table ever consults: the viewer's exact
  // authoritative legalActions, screened by the pure selector.
  const controls = evaluateTurnControls(privateView, viewerId);
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

  if (game.matchEnded) {
    return (
      <section className="game-table-message" role="status" aria-label="Match result">
        {game.matchWinners.length === 0
          ? 'The match is over.'
          : `The match is over — ${game.matchWinners
              .map(
                (winnerId) =>
                  (publicView !== null ? playerNameById(publicView, winnerId) : null) ?? winnerId,
              )
              .join(' and ')} won.`}
      </section>
    );
  }

  if (publicView === null) {
    return (
      <section className="game-table-message" role="status">
        The table is being prepared — waiting for the server’s first projection.
      </section>
    );
  }

  const pending = pendingPrompt(publicView);
  const round = publicView.round;

  return (
    <div className="game-table" data-visual-system="m7-placeholders">
      {state.error !== null && (
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

      <section className="game-players" aria-label="Players at the table">
        <ul className="game-player-list">
          {publicView.players.map((player) => (
            <PlayerZone
              key={player.id}
              player={player}
              assetConfig={assetConfig}
              targetChoice={targetChoiceFor(player.id)}
            />
          ))}
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
    </div>
  );
}
