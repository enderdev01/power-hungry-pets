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
  const hostName = room?.players.find((player) => player.isHost)?.displayName ?? 'the host';
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
              Try again
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
              Back to the form
            </button>
          )}
        </section>
      )}

      {needsSeat && (
        <section className="slip join-prompt" aria-label="Join this room">
          <span className="pin" aria-hidden="true" />
          <p className="field-label">
            <label htmlFor="join-name">Your name</label>
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
              Pin me to this room
            </button>
          </div>
          <div className="actions">
            <button type="button" className="action-button" onClick={() => navigate('/')}>
              Back to the invitation
            </button>
          </div>
        </section>
      )}

      <div className="lobby-columns">
        <section className="slip invitation" aria-label="Room invitation">
          <span className="pin" aria-hidden="true" />
          <p className="field-label">Room code</p>
          <h1 className="room-code">{code}</h1>
          <button
            type="button"
            className="action-button"
            onClick={() => {
              void handleCopy();
            }}
          >
            Copy invite link
          </button>
          {copyOutcome === 'copied' && (
            <p className="hint" role="status">
              Invite link copied for room {code}.
            </p>
          )}
          {copyOutcome === 'failed' && (
            <p className="hint" role="status">
              Copy failed — read the code out loud: {code}.
            </p>
          )}
        </section>

        <section className="slip roster" aria-label="Players at the board">
          <span className="pin" aria-hidden="true" />
          <h2 className="field-label">Players ({room?.players.length ?? 0}/6)</h2>
          <ul className="player-list">
            {room?.players.map((player) => (
              <li key={player.playerId} className="player-row">
                <span className="player-name">{player.displayName}</span>
                <span className="player-meta">seat {player.seatNumber}</span>
                {player.isHost && <span className="host-tag">HOST</span>}
                {player.connected ? (
                  <span className="presence">at the board</span>
                ) : (
                  <span className="presence away">away</span>
                )}
              </li>
            ))}
          </ul>
          {(room === null || room.players.length === 0) && (
            <p className="hint" role="status">
              No slips pinned yet — the board is open. Share the invite and the first name will
              appear here.
            </p>
          )}
          {room !== null && room.players.length === 1 && (
            <p className="hint" role="status">
              Waiting for the first guest — share the invite.
            </p>
          )}
        </section>
      </div>

      {self !== null && (
        <section className="slip host-actions" aria-label="Host actions">
          <span className="pin" aria-hidden="true" />
          <h2 className="field-label">Host actions</h2>
          {matchStarted ? (
            <p className="hint" role="status">
              The match has started — follow the game table.
            </p>
          ) : waitingForHost ? (
            <p className="hint" role="status">
              Waiting for {hostName} to start the match.
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
                Start the match
              </button>
              {decision.reason !== null && (
                <p className="hint" role="status">
                  {startBlockMessage(decision.reason)}
                </p>
              )}
            </>
          )}
          <button type="button" className="action-button" onClick={handleLeave}>
            Leave the room
          </button>
        </section>
      )}

      <section className="slip notice-log" aria-label="Room notices">
        <span className="pin" aria-hidden="true" />
        <h2 className="field-label">Notices</h2>
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
