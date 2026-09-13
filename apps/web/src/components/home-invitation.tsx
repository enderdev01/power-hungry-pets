'use client';

/**
 * The pinned invitation: the home viewport. A dark community noticeboard
 * with one big paper slip holding the player's name, the create action, and
 * the join-by-code action. Every connection action answers textually.
 */
import { useState } from 'react';
import { connectionLine } from '@/lib/room-flow/connection-lines';
import { useRoomFlowState } from '@/lib/room-flow/use-room-flow';
import { ROOM_CODE_LENGTH } from '@power-hungry-pets/protocol';
import type { RoomFlowController } from '@/lib/room-flow/room-flow';

export interface HomeInvitationProps {
  controller: RoomFlowController;
  navigate: (to: string) => void;
}

export function HomeInvitation({ controller, navigate }: HomeInvitationProps) {
  const state = useRoomFlowState(controller);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [codeProblem, setCodeProblem] = useState<string | null>(null);

  const creating = state.busy === 'create' || state.busy === 'join';

  async function handleCreate(): Promise<void> {
    const pinnedCode = await controller.createRoom(name);
    if (pinnedCode !== null) {
      navigate(`/room/${pinnedCode}`);
    }
  }

  function handleJoin(): void {
    const normalized = code.trim().toUpperCase();
    if (normalized.length !== ROOM_CODE_LENGTH) {
      setCodeProblem(`Room codes are ${ROOM_CODE_LENGTH} characters.`);
      return;
    }
    setCodeProblem(null);
    navigate(`/room/${normalized}`);
  }

  return (
    <div>
      <header className="masthead">
        <p className="wordmark">POWER HUNGRY PETS</p>
        <p className="masthead-line">
          A private table for 2–6 players. No account — just a name on a slip.
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

      <section className="slip invitation" aria-label="Room invitation">
        <span className="pin" aria-hidden="true" />
        <h1 className="invitation-title">Tonight&apos;s invitation</h1>

        <div className="field">
          <label className="field-label" htmlFor="display-name">
            Your name
          </label>
          <input
            id="display-name"
            className="field-input"
            value={name}
            maxLength={24}
            onChange={(event) => setName(event.target.value)}
            autoComplete="off"
          />
        </div>

        <div className="actions">
          <button
            type="button"
            className="action-button"
            disabled={name.length === 0 || creating}
            onClick={() => {
              void handleCreate();
            }}
          >
            {state.busy === 'create' ? 'Pinning the room…' : 'Pin a new room'}
          </button>

          <p className="divider" aria-hidden="true">
            — or —
          </p>

          <div className="field">
            <label className="field-label" htmlFor="room-code">
              Room code
            </label>
            <div className="join-row">
              <input
                id="room-code"
                className="field-input code-input"
                value={code}
                maxLength={ROOM_CODE_LENGTH}
                onChange={(event) => {
                  setCode(event.target.value.toUpperCase());
                  setCodeProblem(null);
                }}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={codeProblem !== null}
                aria-describedby={codeProblem !== null ? 'room-code-problem' : undefined}
              />
              <button
                type="button"
                className="action-button"
                disabled={creating}
                onClick={handleJoin}
              >
                {state.busy === 'join' ? 'Joining…' : 'Join a room'}
              </button>
            </div>
            {codeProblem !== null && (
              <p id="room-code-problem" className="hint" role="status">
                {codeProblem}
              </p>
            )}
          </div>
        </div>
      </section>

      <p className="connection-line" data-connection={state.connection}>
        {connectionLine(state.connection)}
      </p>
    </div>
  );
}
