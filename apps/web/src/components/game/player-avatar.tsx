/**
 * Public-safe player seat avatar (M8): a pure-CSS seat marker for the digital
 * tabletop. The marker derives only from the player's display name — initials
 * plus a deterministic variant — never from raw player ids and never from an
 * image asset. It is labelled accessibly so a screen reader announces the seat
 * without exposing anything the public projection does not already publish.
 */

/**
 * Initials for a display name: the first letter of up to two distinct words;
 * for a single-word name the second letter of that word completes the stamp.
 * Letters and digits from any script are honored; a name with none falls back
 * to a neutral "??" stamp.
 */
export function playerInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const lettersOf = (word: string): string[] => [...word].filter((ch) => /[\p{L}\p{N}]/u.test(ch));
  const initials: string[] = [];
  for (const word of words) {
    const letters = lettersOf(word);
    if (letters.length > 0) {
      initials.push(letters[0]!.toUpperCase());
    }
    if (initials.length === 2) break;
  }
  if (initials.length === 0) {
    return '??';
  }
  if (initials.length === 1) {
    const letters = lettersOf(words[0]!);
    initials.push(letters.length >= 2 ? letters[1]!.toUpperCase() : '?');
  }
  return initials.join('');
}

/**
 * Deterministic stamp variant (0–3) from the name's code points: four fixed
 * paper/ink treatments the stylesheet resolves — never a random value, never
 * a color outside the closed palette.
 */
export function avatarVariant(name: string): number {
  let hash = 0;
  for (const ch of name) {
    hash = (hash * 31 + ch.codePointAt(0)!) % 997;
  }
  return hash % 4;
}

interface PlayerAvatarProps {
  /** Seat display name: the only input the marker may derive from. */
  name: string;
  /** Optional accessible-label override for special seats (e.g. the viewer). */
  label?: string;
}

export function PlayerAvatar({ name, label }: PlayerAvatarProps) {
  return (
    <span
      className="game-seat-avatar"
      role="img"
      aria-label={label ?? `Asiento de ${name}`}
      data-avatar-variant={avatarVariant(name)}
    >
      {/* The visible initials repeat the accessible label decoratively. */}
      <span aria-hidden="true">{playerInitials(name)}</span>
    </span>
  );
}
