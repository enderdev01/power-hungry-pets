/**
 * Clipboard helper for the invite link. Textual outcomes only: the copy
 * action always ends in an immediate, visible confirmation or honest failure.
 */
export type CopyOutcome = 'copied' | 'failed';

/** Copies the room's invite URL; resolves to a textual outcome. */
export async function copyInviteLink(code: string): Promise<CopyOutcome> {
  const url = `${window.location.origin}/room/${code}`;
  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.clipboard !== undefined &&
      typeof navigator.clipboard.writeText === 'function'
    ) {
      await navigator.clipboard.writeText(url);
      return 'copied';
    }
  } catch {
    // Clipboard permission refused or write failed: honest failure below.
  }
  return 'failed';
}
