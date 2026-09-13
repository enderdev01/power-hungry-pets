/**
 * Acknowledgement error handling contract: every server error code a
 * room-flow client can observe must map to a human sentence and a recovery
 * path. The UI never decides legality — it only explains the server verdict.
 */
import { describeAckError } from '@/lib/room-flow/ack-errors';

describe('describeAckError', () => {
  it('explains a full room and points back to editing the input', () => {
    expect(describeAckError('ROOM_FULL')).toEqual({
      sentence: expect.stringContaining('6 players'),
      recovery: 'edit-input',
    });
  });

  it('explains an unknown room code', () => {
    expect(describeAckError('ROOM_NOT_FOUND')).toEqual({
      sentence: expect.any(String),
      recovery: 'edit-input',
    });
    expect(describeAckError('ROOM_NOT_FOUND').sentence).toMatch(/code/i);
  });

  it('explains an unusable display name', () => {
    const described = describeAckError('INVALID_DISPLAY_NAME');
    expect(described.recovery).toBe('edit-input');
    expect(described.sentence).toMatch(/name/i);
  });

  it('explains that only the host can start', () => {
    const described = describeAckError('NOT_HOST');
    expect(described.recovery).toBe('none');
    expect(described.sentence).toMatch(/host/i);
  });

  it('offers a retry for rate limiting and internal failures', () => {
    expect(describeAckError('RATE_LIMITED').recovery).toBe('retry');
    expect(describeAckError('INTERNAL_ERROR').recovery).toBe('retry');
  });

  it('asks the player to rejoin when the seat binding is lost', () => {
    expect(describeAckError('INVALID_RECONNECT_TOKEN').recovery).toBe('edit-input');
    expect(describeAckError('SOCKET_NOT_BOUND').recovery).toBe('edit-input');
  });

  it('always returns a nonempty sentence for unknown codes', () => {
    const described = describeAckError('SOMETHING_NEW_FROM_SERVER' as never);
    expect(described.sentence.length).toBeGreaterThan(0);
    expect(described.recovery).toBe('retry');
  });
});
