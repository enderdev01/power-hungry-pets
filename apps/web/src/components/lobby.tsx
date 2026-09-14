'use client';

/**
 * The lobby: the room's noticeboard after the invitation is pinned. Player
 * slips gather in real time, every connection event is confirmed textually,
 * and the host start action is gated by the published lobby contract.
 */
import { useEffect, useState } from 'react';
import { connectionLine } from '@/lib/room-flow/connection-lines';
import { useRoomFlowState } from '@/lib/room-flow/use-room-flow';
import { copyInviteLink, type CopyOutcome } from '@/lib/room-flow/clipboard';
import { evaluateStart, startBlockMessage } from '@/lib/room-flow/selectors';
import type { RoomFlowController } from '@/lib/room-flow/room-flow';

export interface LobbyProps {
  code: string;
  controller: RoomFlowController;
  navigate: (to: string) => void;
}

export function Lobby({ code, controller, navigate }: LobbyProps) {
  const state = useRoomFlowState(controller);
  const [copyOutcome, setCopyOutcome] = useState<CopyOutcome | null>(null);
  const [joinName, setJoinName] = useState('');

  useEffect(() => {
    controller.enterRoom(code);
  }, [controller, code]);

  const room = state.room;
  const self = state.self;
  const decision = evaluateStart(room, self, state.connection);
  const hostName =
    room?.players.find((player) => player.isHost)?.displayName ?? 'la persona anfitriona';
  const matchStarted = room?.status === 'IN_MATCH';
  const waitingForHost = decision.reason === 'not-host' && !matchStarted;
  const needsSeat = self === null;

  async function handleCopy(): Promise<void> {
    setCopyOutcome(await copyInviteLink(code));
  }

  function handleLeave(): void {
    void controller.leaveRoom().then((left) => {
      if (left) {
        navigate('/');
      }
    });
  }

  return (
    <div>
      <header className="masthead">
        <p className="wordmark">POWER HUNGRY PETS</p>
        <p className="connection-line" data-connection={state.connection}>
          {connectionLine(state.connection)}
        </p>
      </header>

      {state.error !== null && (
        <section className="slip error-slip" role="alert">
          <span className="pin pin-error" aria-hidden="true" />
          <p className="error-sentence">{state.error.sentence}</p>
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
          {state.error.recovery === 'edit-input' && (
            <button
              type="button"
              className="action-button"
              onClick={() => {
                controller.clearError();
              }}
            >
              Volver al formulario
            </button>
          )}
        </section>
      )}

      {needsSeat && (
        <section className="slip join-prompt" aria-label="Unirse a esta sala">
          <span className="pin" aria-hidden="true" />
          <p className="field-label">
            <label htmlFor="join-name">Tu nombre</label>
          </p>
          <div className="join-row">
            <input
              id="join-name"
              className="field-input"
              value={joinName}
              maxLength={24}
              onChange={(event) => setJoinName(event.target.value)}
              autoComplete="off"
            />
            <button
              type="button"
              className="action-button"
              disabled={joinName.length === 0}
              onClick={() => {
                void controller.joinRoom(code, joinName);
              }}
            >
              Unirme a esta sala
            </button>
          </div>
          <div className="actions">
            <button type="button" className="action-button" onClick={() => navigate('/')}>
              Volver a la invitación
            </button>
          </div>
        </section>
      )}

      <div className="lobby-columns">
        <section className="slip invitation" aria-label="Invitación de la sala">
          <span className="pin" aria-hidden="true" />
          <p className="field-label">Código de sala</p>
          <h1 className="room-code">{code}</h1>
          <button
            type="button"
            className="action-button"
            onClick={() => {
              void handleCopy();
            }}
          >
            Copiar enlace de invitación
          </button>
          {copyOutcome === 'copied' && (
            <p className="hint" role="status">
              Se copió el enlace de invitación de la sala {code}.
            </p>
          )}
          {copyOutcome === 'failed' && (
            <p className="hint" role="status">
              No se pudo copiar el enlace. Compartí este código: {code}.
            </p>
          )}
        </section>

        <section className="slip roster" aria-label="Jugadores en el tablero">
          <span className="pin" aria-hidden="true" />
          <h2 className="field-label">Jugadores ({room?.players.length ?? 0}/6)</h2>
          <ul className="player-list">
            {room?.players.map((player) => (
              <li key={player.playerId} className="player-row">
                <span className="player-name">{player.displayName}</span>
                <span className="player-meta">asiento {player.seatNumber}</span>
                {player.isHost && <span className="host-tag">ANFITRIÓN</span>}
                {player.connected ? (
                  <span className="presence">en el tablero</span>
                ) : (
                  <span className="presence away">ausente</span>
                )}
              </li>
            ))}
          </ul>
          {(room === null || room.players.length === 0) && (
            <p className="hint" role="status">
              Todavía no hay fichas en el tablero. Compartí la invitación y el primer nombre
              aparecerá acá.
            </p>
          )}
          {room !== null && room.players.length === 1 && (
            <p className="hint" role="status">
              Esperando al primer invitado. Compartí la invitación.
            </p>
          )}
        </section>
      </div>

      {self !== null && (
        <section className="slip host-actions" aria-label="Acciones del anfitrión">
          <span className="pin" aria-hidden="true" />
          <h2 className="field-label">Acciones del anfitrión</h2>
          {matchStarted ? (
            <p className="hint" role="status">
              La partida comenzó. Seguí el juego en la mesa.
            </p>
          ) : waitingForHost ? (
            <p className="hint" role="status">
              Esperando a que {hostName} comience la partida.
            </p>
          ) : (
            <>
              <button
                type="button"
                className="action-button"
                disabled={!decision.allowed}
                onClick={() => {
                  void controller.startMatch();
                }}
              >
                Comenzar la partida
              </button>
              {decision.reason !== null && (
                <p className="hint" role="status">
                  {startBlockMessage(decision.reason)}
                </p>
              )}
            </>
          )}
          <button type="button" className="action-button" onClick={handleLeave}>
            Salir de la sala
          </button>
        </section>
      )}

      <section className="slip notice-log" aria-label="Avisos de la sala">
        <span className="pin" aria-hidden="true" />
        <h2 className="field-label">Avisos</h2>
        <div className="notice-list" role="log" aria-live="polite">
          {[...state.notices].reverse().map((notice) => (
            <p key={notice.id} className={`notice notice-${notice.tone}`}>
              {notice.text}
            </p>
          ))}
        </div>
      </section>
    </div>
  );
}
