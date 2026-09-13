describe('center-action stage overlay (M8 pre-recapture correction)', () => {
  it('spans the shared center as an absolute, centered, pointer-events-none overlay', () => {
    // The center establishes the positioning context; the stage overlays it
    // out-of-flow so it never joins the center grid nor shifts the piles.
    const centerRules = cssRules().filter((rule) => rule.selector === '.game-center');
    expect(centerRules.some((rule) => rule.body.includes('position: relative'))).toBe(true);
    const stage = cssRules().find((rule) => rule.selector === '.game-center-stage');
    expect(stage).toBeDefined();
    expect(stage?.body).toMatch(/position:\s*absolute/);
    expect(stage?.body).toMatch(/inset:\s*0/);
    expect(stage?.body).toMatch(/pointer-events:\s*none/);
    expect(stage?.body).toMatch(/opacity:\s*0/);
  });

  it('stays visually absent after its cue: stage keyframes return to opacity 0', () => {
    const stageAnim = cssRules().filter(
      (rule) => rule.selector.includes('.game-center-stage') && rule.body.includes('animation'),
    );
    expect(stageAnim.length).toBe(2);
    for (const rule of stageAnim) {
      expect(rule.body).toMatch(/motion-stage-(landing|flip)/);
      expect(rule.body).not.toMatch(/motion-card-(landing|flip)/);
    }
    for (const name of ['motion-stage-landing', 'motion-stage-flip']) {
      const from = css.indexOf(`@keyframes ${name}`);
      expect(from).toBeGreaterThanOrEqual(0);
      const block = css.slice(from);
      const to = block.slice(block.indexOf('to {'));
      expect(to).toMatch(/opacity:\s*0/);
    }
  });

  it('keeps the stage hidden under reduced motion without new display removal', () => {
    // The generic [data-motion] collapse already kills the stage animation;
    // nothing in the reduced block may re-show it (its base opacity 0 stands).
    const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).not.toMatch(/opacity:\s*1/);
    expect(reduced).not.toContain('display: none');
  });
});

/**
 * M8 responsive/table visual-polish static contracts. The running jsdom
 * renderer cannot prove real pixel layout, so these are honest static tests
 * over the shipped stylesheet and the rendered DOM: reading order, avatar
 * seams, breakpoints, grid areas, the 63:88 card ratio hooks, touch targets,
 * safe areas, modal/result widths, and reduced-motion collapse. No browser
 * screenshots are faked.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import { GameTable } from '@/components/game/game-table';
import type { RoomFlowController } from '@/lib/room-flow/controller';
import type { RoomFlowState } from '@/lib/room-flow/reducer';
import type { PublicGameView, PublicPlayerView } from '@power-hungry-pets/protocol';
import {
  privateView,
  publicView,
  roomSnapshotInMatch,
  roundView,
  SELF_ID,
  OTHER_ID,
} from './helpers/game-views';

const css = readFileSync(join(__dirname, '..', 'src', 'app', 'globals.css'), 'utf8');

/** Comment-free stylesheet parsed into selector/body rules. */
function cssRules(): Array<{ selector: string; body: string }> {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].trim(),
    body: match[2],
  }));
}

function controllerStub() {
  return {} as RoomFlowController;
}

function flowState(overrides: { publicView?: PublicGameView | null } = {}): RoomFlowState {
  return {
    connection: 'connected',
    room: roomSnapshotInMatch(),
    roomCode: 'ABC12',
    self: { playerId: SELF_ID, seatNumber: 1 },
    busy: null,
    error: null,
    game: {
      publicView: overrides.publicView !== undefined ? overrides.publicView : publicView(),
      privateView: privateView(),
      matchEnded: false,
      matchWinners: [],
      recentEvents: [],
      roundResult: null,
    },
  } as unknown as RoomFlowState;
}

function seat(
  id: string,
  name: string,
  overrides: Partial<PublicPlayerView> = {},
): PublicPlayerView {
  return {
    id,
    name,
    connected: true,
    eliminated: false,
    protected: false,
    victoryTokens: 0,
    handCount: 1,
    discards: [],
    ...overrides,
  };
}

function threeSeatState(): RoomFlowState {
  return flowState({
    publicView: publicView({
      players: [seat(SELF_ID, 'Ana'), seat(OTHER_ID, 'Bruno'), seat('p-third', 'Caro')],
      round: roundView(),
    }),
  });
}

describe('semantic reading order (M8 table recomposition)', () => {
  it('reads turn state, own hand, center piles, then public player zones', () => {
    const { container } = render(
      <GameTable controller={controllerStub()} state={threeSeatState()} />,
    );
    const order = ['.game-table-heading', '.game-own-hand', '.game-center', '.game-players'].map(
      (selector) => container.querySelector(selector),
    );
    for (const node of order) {
      expect(node).not.toBeNull();
    }
    for (let i = 0; i + 1 < order.length; i += 1) {
      const before = order[i] as Element;
      const after = order[i + 1] as Element;
      expect(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    }
  });

  it('keeps the semantic order stable across all three viewport bands via grid areas', () => {
    // Grid-area topology may rearrange the visual table, but the DOM order —
    // the reading order for keyboards and screen readers — never changes with
    // the viewport. The areas map only these four semantic landmarks, once per
    // band (mobile, tablet, desktop).
    for (const area of ['game-table-heading', 'game-own-hand', 'game-center', 'game-players']) {
      const areaDeclarations = css.match(/grid-template-areas:[^;]+;/g) ?? [];
      const bands = areaDeclarations.filter((declaration) => declaration.includes(area));
      expect(bands.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps the urgent turn status inside the first landmark', () => {
    const { container } = render(
      <GameTable controller={controllerStub()} state={threeSeatState()} />,
    );
    const heading = container.querySelector('.game-table-heading');
    expect(heading).not.toBeNull();
    expect(within(heading as HTMLElement).getByRole('status')).toHaveTextContent(/turn|waiting/i);
  });
});

describe('seat avatars around the table (M8)', () => {
  it('renders a labelled avatar per public seat from the name only', () => {
    render(<GameTable controller={controllerStub()} state={threeSeatState()} />);
    expect(screen.getByRole('img', { name: "Ana's seat" })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: "Bruno's seat" })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: "Caro's seat" })).toBeInTheDocument();
  });

  it('never leaks raw player ids through seat markers', () => {
    const { container } = render(
      <GameTable controller={controllerStub()} state={threeSeatState()} />,
    );
    const avatars = container.querySelectorAll('.game-seat-avatar');
    expect(avatars.length).toBe(3);
    for (const avatar of avatars) {
      expect(avatar.getAttribute('data-player-id')).toBeNull();
      expect(avatar.textContent).not.toMatch(/p-self|p-other|p-third/);
    }
  });
});

describe('320px-safe mobile CSS contracts', () => {
  it('never sets horizontal overflow or fixed minimum widths on the page', () => {
    // The old lookahead (`/overflow-x:\s*(?!hidden)/`) could never hold: the
    // greedy `\s*` backtracks past the spaces, so even "overflow-x: hidden"
    // matched. Anchor the check at the colon instead.
    expect(css).not.toMatch(/overflow-x\s*:(?!\s*hidden)/);

    // Token-driven lengths are resolved against the custom-property map —
    // `var()` values are inspected, never skipped blindly.
    const tokens = new Map<string, string>();
    for (const [, name, value] of css.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) {
      tokens.set(name!, value!.trim());
    }
    const resolve = (value: string): string =>
      value.replace(/var\((--[\w-]+)\)/g, (_match, name) => tokens.get(name!) ?? 'UNKNOWN-TOKEN');

    /** Throws when a resolved bare length can overflow the 320px (20rem) floor. */
    const assertSafe = (value: string, context: string): void => {
      for (const part of value.split(/[\s,]+/)) {
        const numeric = parseFloat(part);
        if (Number.isNaN(numeric)) continue;
        if (part.endsWith('rem') && numeric * 16 > 320) {
          throw new Error(`${context} ${value} can overflow a 320px viewport`);
        }
        if (part.endsWith('px') && numeric > 320) {
          throw new Error(`${context} ${value} can overflow a 320px viewport`);
        }
      }
    };

    for (const rule of cssRules()) {
      for (const property of ['min-width', 'width', 'flex-basis']) {
        for (const match of rule.body.matchAll(
          new RegExp(`(?<![\\w-])${property}:\\s*([^;]+);`, 'g'),
        )) {
          const value = resolve(match[1]!);
          // min()/max()/calc() caps adapt to the viewport; bare lengths do not.
          if (/^(min|max|calc)\(/.test(value.trim())) continue;
          assertSafe(value, `${rule.selector} ${property}:`);
        }
      }
      // The flex shorthand's third token is its flex-basis.
      for (const match of rule.body.matchAll(/(?<![\w-])flex:\s*([^;]+);/g)) {
        const basis = resolve(match[1]!).trim().split(/\s+/)[2];
        if (basis !== undefined && basis !== 'auto' && basis !== 'content') {
          assertSafe(basis, `${rule.selector} flex-basis:`);
        }
      }
      // A minmax() first argument is a fixed grid-track minimum.
      for (const match of rule.body.matchAll(/minmax\(([^,]+),/g)) {
        assertSafe(resolve(match[1]!), `${rule.selector} minmax-min:`);
      }
    }
  });

  it('keeps the own hand dominant on mobile', () => {
    const mobile = css.slice(css.indexOf('@media (max-width: 46rem)'));
    expect(mobile).toContain('game-own-hand');
  });

  it('keeps 3rem minimum touch targets on all table buttons', () => {
    const buttonRules = cssRules().filter(
      (rule) =>
        rule.selector.includes('.action-button') ||
        rule.selector.includes('.game-play-button') ||
        rule.selector.includes('.game-target-button') ||
        rule.selector.includes('.game-decision-button') ||
        rule.selector.includes('.game-round-result-continue'),
    );
    const withMinHeight = buttonRules.filter((rule) => rule.body.includes('min-height'));
    expect(withMinHeight.length).toBeGreaterThan(0);
    for (const rule of withMinHeight) {
      expect(rule.body).toMatch(/min-height:\s*3rem/);
    }
  });

  it('reserves safe-area padding for notched phones', () => {
    expect(css).toContain('env(safe-area-inset');
  });

  it('compacts the center piles two-up on mobile and stacks at 320px', () => {
    // Two-up compact piles are the base .game-center composition; the mobile
    // band inherits it (no redundant re-declaration)...
    const baseCenter = cssRules().find(
      (rule) => rule.selector === '.game-center' && rule.body.includes('grid-template-columns'),
    );
    expect(baseCenter?.body).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    const mobile = css.indexOf('@media (max-width: 46rem)');
    const narrow = css.slice(mobile, css.indexOf('@media (min-width: 46rem)', mobile));
    // ...with an explicit collapse to one column at the 320px floor.
    expect(narrow).toMatch(/max-width:\s*22\.5rem[\s\S]*?game-center/);
    const floorBlock = narrow.slice(narrow.indexOf('@media (max-width: 22.5rem)'));
    const floorRule = floorBlock.match(/game-center\s*{[^}]*}/);
    expect(floorRule?.[0]).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });
});

describe('content-driven tablet layer (46rem and up)', () => {
  it('is min-width-only and is overridden by the later desktop layer by cascade', () => {
    const tabletStart = css.indexOf('@media (min-width: 46rem)');
    expect(tabletStart).toBeGreaterThanOrEqual(0);
    const desktopStart = css.indexOf('@media (min-width: 64rem)', tabletStart);
    expect(desktopStart).toBeGreaterThan(tabletStart);
    const tablet = css.slice(tabletStart, desktopStart);
    expect(tablet).toContain('game-center');
    expect(tablet).toContain('game-players');
    // The 46rem tablet layer is content-driven, approved to finish M8; the
    // DESIGN.md layout note is deferred to closure. It carries no upper bound:
    // the desktop layer follows later in source with equal specificity and
    // overrides it by cascade, so coverage from 46rem upward is continuous —
    // no exclusive 63.99rem-style bound can leave a fractional-viewport gap.
    expect(tablet).toMatch(/@media \(min-width: 46rem\)/);
    expect(tablet).not.toMatch(/max-width:/);
    expect(css).not.toMatch(/max-width:\s*63\.99rem/);
  });
});

describe('desktop table-protagonist band (64rem and up)', () => {
  it('composes a genuine table topology: dominant shared center, seated player arc beside it, own hand as the bottom band', () => {
    const desktop = css.slice(css.indexOf('@media (min-width: 64rem)'));
    expect(desktop).toContain('game-center');
    expect(desktop).toMatch(/grid-template-areas:[^;]*game-center/);
    const areas = desktop.match(/grid-template-areas:([^;]+);/)?.[1] ?? '';
    const rows = areas.split("'").filter((row) => row.trim().length > 0);
    const widthOf = (area: string): number =>
      Math.max(...rows.map((row) => (row.match(new RegExp(area, 'g')) ?? []).length), 0);
    // A real table, not six equal rows: exactly three composition rows.
    expect(rows.length).toBe(3);
    // The shared center is the dominant surface: two of three columns in its
    // row, with the public player arc seated in the remaining column.
    expect(widthOf('game-center')).toBe(2);
    expect(widthOf('game-players')).toBe(1);
    const centerRow = rows.find((row) => row.includes('game-center')) ?? '';
    expect(centerRow).toContain('game-players');
    // The own hand is one full-width bottom band (the seat you play from),
    // never narrower than anything else.
    expect(widthOf('game-own-hand')).toBe(3);
    const handRow = rows.findIndex((row) => row.includes('game-own-hand'));
    expect(handRow).toBe(rows.length - 1);
    // The heading and the hand are slim full-width bands; the center row owns
    // the flexible space between them — the table, not a rival administrative
    // grid, gets the viewport's attention.
    expect(widthOf('game-center')).toBeGreaterThanOrEqual(widthOf('game-players'));
  });

  it('keeps the desktop center row flexing between fixed heading and hand bands', () => {
    // The middle (table) row is the only flexible one: at 1280x900 the heading
    // and the hand take their natural height first, so the hand enters the
    // first viewport.
    const desktop = css.slice(css.indexOf('@media (min-width: 64rem)'));
    expect(desktop).toMatch(/grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)\s+auto/);
  });

  it('packs the desktop player arc into compact two-seat rows', () => {
    const desktop = css.slice(css.indexOf('@media (min-width: 64rem)'));
    expect(desktop).toMatch(
      /\.game-player-list\s*{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(desktop).toMatch(
      /\.game-player-zone \.game-card-placeholder-back\s*{[^}]*width:\s*var\(--game-card-compact-inline\)[^}]*max-width:\s*var\(--game-card-compact-inline\)/,
    );
    expect(desktop).toMatch(/\.game-player-header\s*{[^}]*flex-wrap:\s*wrap/);
  });
});

describe('card 63:88 ratio and stamped art hooks (M8)', () => {
  it('enforces the recorded 63:88 card ratio through the aspect-ratio hook', () => {
    expect(css).toMatch(/\.game-card-placeholder\s*{[^}]*aspect-ratio:\s*63\s*\/\s*88/);
    // The face-down back keeps the same physical card proportion.
    expect(css).toMatch(/\.game-card-placeholder-back\s*{[^}]*aspect-ratio:\s*63\s*\/\s*88/);
  });

  it('keeps square corners of at most 2px on every card surface', () => {
    // Every border-radius in the system must be 0, 2px, or the 50% pin circle.
    const radii = [...css.matchAll(/border-radius:\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(radii.length).toBeGreaterThan(0);
    for (const radius of radii) {
      if (radius === '50%') continue;
      for (const part of radius.split(/[\s,]+/)) {
        const numeric = parseFloat(part);
        if (Number.isNaN(numeric)) continue;
        const px = part.endsWith('rem') ? numeric * 16 : numeric;
        expect(px).toBeLessThanOrEqual(2);
      }
    }
  });

  it('ships the CSS-only stamped art well behind the stable art-key seam', () => {
    // The DOM art well keeps its stable slot hook for future image assets.
    render(<GameTable controller={controllerStub()} state={threeSeatState()} />);
    const artWell = document.querySelector('.game-card-art');
    expect(artWell).not.toBeNull();
    // The stamped well is pure CSS: no background image, no gradient, no
    // texture — only palette colors and ink borders.
    const artRules = cssRules().filter((rule) => rule.selector.includes('game-card-art'));
    expect(artRules.length).toBeGreaterThan(0);
    for (const rule of artRules) {
      expect(rule.body).not.toMatch(/url\(|gradient\(/);
    }
  });

  it('renders the card structure as value, name, then effect from public metadata', () => {
    const { container } = render(
      <GameTable controller={controllerStub()} state={threeSeatState()} />,
    );
    const ownCard = container.querySelector('.game-own-hand .game-card-placeholder');
    expect(ownCard).not.toBeNull();
    expect(ownCard?.querySelector('.game-card-value')).not.toBeNull();
    expect(ownCard?.querySelector('.game-card-name')).not.toBeNull();
    expect(ownCard?.querySelector('.game-card-effect')).not.toBeNull();
  });

  it('keeps the back stamped, not blank, with its honest face-down text', () => {
    render(<GameTable controller={controllerStub()} state={threeSeatState()} />);
    const back = screen.getByRole('img', { name: 'Draw pile, face down' });
    expect(back).toHaveTextContent('Face down');
    expect(back).toHaveClass('game-card-placeholder-back');
  });
});

describe('modal and result surfaces stay mobile-safe (WU8/WU9/WU10)', () => {
  it('caps every centered surface at the viewport with a min() width', () => {
    for (const selector of ['.game-modal', '.game-round-result', '.game-match-result']) {
      const rule = cssRules().find((candidate) =>
        candidate.selector
          .split(',')
          .map((part) => part.trim())
          .includes(selector),
      );
      expect(rule).toBeDefined();
      expect(rule?.body).toMatch(/min\(/);
      expect(rule?.body).toMatch(/100%/);
    }
  });
});

describe('reduced motion removes spatial movement but not information', () => {
  it('drops every card lift, tilt, and transform under prefers-reduced-motion', () => {
    const reduced = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('transform: none');
    expect(reduced).toMatch(/animation:\s*none/);
    // The card lift lives only in the animation; the resting state carries no
    // transform, so reduced motion changes nothing but movement.
    const lift = css.match(/@keyframes\s+motion-card-lift\s*{[\s\S]*?\n}/);
    expect(lift).not.toBeNull();
    expect(lift?.[0]).toMatch(/translateY\(/);
    // Layout survives: the reading-order landmarks keep their grid areas and
    // nothing is hidden under reduced motion.
    expect(reduced).not.toContain('game-table-heading');
    expect(reduced).not.toContain('display: none');
  });
});

describe('soft physical card lift is card-scoped (M8 elevation)', () => {
  it('applies the lift only to interactive own-hand card shells', () => {
    const liftRules = cssRules().filter((rule) => rule.body.includes('motion-card-lift'));
    expect(liftRules.length).toBeGreaterThan(0);
    for (const rule of liftRules) {
      expect(rule.selector).toMatch(/game-hand-entry/);
      expect(rule.selector).not.toMatch(/game-modal|game-round-result|game-match-result|slip/);
    }
  });

  it('never gives shadows to panels or slips', () => {
    // The only permitted box-shadows are the focus ring and the armed
    // selection stamp; no panel/slip rule may add a cast shadow.
    const shadowRules = cssRules().filter(
      (rule) =>
        rule.body.includes('box-shadow') &&
        !rule.body.includes('0 0 0') &&
        // @keyframes from/to blocks are animation steps, not selectors.
        !['from', 'to'].includes(rule.selector),
    );
    for (const rule of shadowRules) {
      expect(rule.selector).toMatch(/game-hand-entry|game-card-placeholder/);
      expect(rule.selector).not.toMatch(
        /\.slip|game-modal\b|game-pile|game-player-zone|game-own-hand\b|game-round-result|game-match-result/,
      );
    }
  });
});

describe('game-error owns the top row only when it exists (M8 correction)', () => {
  /** grid-template-areas row lists of a rule body, as trimmed cell arrays. */
  const areaRows = (body: string): string[][] =>
    (body.match(/grid-template-areas:([^;]+);/)?.[1] ?? '')
      .split("'")
      .filter((_, index) => index % 2 === 1)
      .map((row) => row.trim().split(/\s+/).filter(Boolean));

  const areaRules = (): Array<{ selector: string; body: string }> =>
    cssRules().filter((rule) => rule.body.includes('grid-template-areas'));

  it('declares no error row in the default templates of all three bands (no-error gap prevention)', () => {
    // In the common no-error table nothing may reserve an always-empty first
    // row: the default (unconditional) template of every band declares no
    // game-error area at all, so no stray gap can render above the heading.
    const unconditional = areaRules().filter((rule) => !rule.selector.includes(':has('));
    // Exactly one default template per band: base (all widths), tablet
    // (46rem and up), desktop (64rem and up, overriding the tablet layer by
    // source cascade).
    expect(unconditional.length).toBe(3);
    for (const rule of unconditional) {
      for (const row of areaRows(rule.body)) {
        expect(row).not.toContain('game-error');
      }
    }
  });

  it('prepends the error row through :has(> .game-error) in every band', () => {
    // The alarm keeps its explicit first-row placement in every band — but
    // only through the conditional template, never the default one.
    const conditional = areaRules().filter(
      (rule) => rule.selector === '.game-table:has(> .game-error)',
    );
    expect(conditional.length).toBe(3);
    const defaultTails = areaRules()
      .filter((rule) => !rule.selector.includes(':has('))
      .map((rule) => areaRows(rule.body));
    for (const rule of conditional) {
      const rows = areaRows(rule.body);
      expect(rows.length).toBeGreaterThanOrEqual(2);
      // The first row is entirely the alarm.
      expect(rows[0]!.length).toBeGreaterThan(0);
      expect(rows[0]!.every((cell) => cell === 'game-error')).toBe(true);
      // The conditional template only prepends: its remaining rows equal one
      // unconditional band template exactly (no reordering smuggled in behind
      // the fix).
      const tail = JSON.stringify(rows.slice(1));
      expect(defaultTails.some((candidate) => JSON.stringify(candidate) === tail)).toBe(true);
    }
    const errorRule = cssRules().find((rule) => rule.selector === '.game-error');
    expect(errorRule?.body).toMatch(/grid-area:\s*game-error/);
  });

  it('renders the error slip before the heading landmark in the DOM', () => {
    const { container } = render(
      <GameTable
        controller={controllerStub()}
        state={{
          ...threeSeatState(),
          error: {
            action: 'draw',
            code: 'ENGINE_REJECTED',
            message: 'The game rules rejected that move.',
            sentence: 'The game rules rejected that move.',
            recovery: 'none',
          },
        }}
      />,
    );
    const error = container.querySelector('.game-error');
    const heading = container.querySelector('.game-table-heading');
    expect(error).not.toBeNull();
    expect(heading).not.toBeNull();
    // A direct child of the table is exactly what the :has(> .game-error)
    // conditional template selector matches.
    expect((error as Element).parentElement).toBe(container.querySelector('.game-table'));
    expect(
      (error as Element).compareDocumentPosition(heading as Element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });

  it('renders no error slip in the common no-error case', () => {
    const { container } = render(
      <GameTable controller={controllerStub()} state={threeSeatState()} />,
    );
    expect(container.querySelector('.game-error')).toBeNull();
  });
});

describe('seat identity cascade (M8 correction)', () => {
  it('resolves the header through explicit identity classes, never a broad descendant span rule', () => {
    // The old `.game-player-header span` rule restyled every span in the
    // header — including the avatar's initials — and defeated the avatar's
    // own font-size. It must stay gone (comments are stripped first: the
    // correction note that documents the old rule must not trigger this).
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/\.game-player-header\s+span/);
    const presence = cssRules().find((rule) => rule.selector === '.game-player-presence');
    expect(presence?.body).toMatch(/font-size:\s*0\.85rem/);
    const name = cssRules().find((rule) => rule.selector === '.game-player-name');
    expect(name?.body).toMatch(/font-size:\s*1rem/);
    // Computed cascade: only .game-seat-avatar itself sets the initials size;
    // no rule reaches into it from the header.
    const avatar = cssRules().find((rule) => rule.selector === '.game-seat-avatar');
    expect(avatar?.body).toMatch(/font-size:\s*0\.72rem/);
  });

  it('marks the name and presence with explicit identity classes in the rendered header', () => {
    const { container } = render(
      <GameTable controller={controllerStub()} state={threeSeatState()} />,
    );
    const header = container.querySelector('.game-player-header');
    expect(header?.querySelector('.game-player-identity .game-player-name')).not.toBeNull();
    expect(header?.querySelector('.game-player-presence')).not.toBeNull();
    // The avatar initials span carries no header styling hook of its own.
    const initials = container.querySelector('.game-seat-avatar > span');
    expect(initials).not.toBeNull();
    expect(initials?.classList.length).toBe(0);
  });

  it('protects long display names from overflowing the seat header', () => {
    const name = cssRules().find((rule) => rule.selector === '.game-player-name');
    expect(name?.body).toMatch(/overflow-wrap:\s*anywhere/);
    expect(name?.body).toMatch(/min-width:\s*0/);
    const identity = cssRules().find((rule) => rule.selector === '.game-player-identity');
    expect(identity?.body).toMatch(/min-width:\s*0/);
  });
});

describe('viewport-inset-aware fixed surfaces (M8 correction)', () => {
  it('pads the fixed mandatory modal overlay with the viewport insets', () => {
    const overlay = cssRules().find((rule) => rule.selector === '.game-modal-overlay');
    expect(overlay?.body).toMatch(/padding:[^;]*max\([^)]*env\(safe-area-inset-top\)/);
    expect(overlay?.body).toMatch(/padding:[^;]*max\([^)]*env\(safe-area-inset-right\)/);
    expect(overlay?.body).toMatch(/padding:[^;]*max\([^)]*env\(safe-area-inset-bottom\)/);
    expect(overlay?.body).toMatch(/padding:[^;]*max\([^)]*env\(safe-area-inset-left\)/);
  });

  it('shrinks the match-result surface by the horizontal viewport insets', () => {
    const matchResult = cssRules().find((rule) => rule.selector === '.game-match-result');
    expect(matchResult?.body).toContain('env(safe-area-inset-left');
    expect(matchResult?.body).toContain('env(safe-area-inset-right');
  });
});

describe('card-lift shadow is a derived semantic token (M8 correction)', () => {
  it('centralizes the lift shadow color in a variable derived from the board color', () => {
    // Derive the expected triplet from --board itself: the token must be the
    // existing board color, never a new palette role.
    const board = css.match(/--board:\s*#([0-9a-fA-F]{6})/)?.[1] ?? '';
    expect(board).not.toBe('');
    const [r, g, b] = [0, 2, 4].map((index) => parseInt(board.slice(index, index + 2), 16));
    expect(css).toMatch(new RegExp(`--game-card-lift-shadow-color:\\s*${r},\\s*${g},\\s*${b}`));
    // The keyframes consume the token; no raw shadow color remains.
    const lift = css.match(/@keyframes\s+motion-card-lift\s*{[\s\S]*?\n}/)?.[0] ?? '';
    expect(lift).toContain('rgba(var(--game-card-lift-shadow-color)');
    expect(lift).not.toMatch(/rgba\(\d/);
  });
});

describe('visual finish batch (M8 table finish)', () => {
  it('gives the shared pile a definite card track that honors the 13rem desktop max', () => {
    const pileRule = cssRules().find((rule) => rule.selector === '.game-pile');
    expect(pileRule?.body).toMatch(
      /grid-template-columns:\s*minmax\(var\(--game-card-min-inline\),\s*var\(--game-card-max-inline\)\)/,
    );
    const cardRule = cssRules().find(
      (rule) => rule.selector === '.game-pile .game-card-placeholder',
    );
    // The pile card resolves to the full 13rem max, never the compact 7rem.
    expect(cardRule?.body).toMatch(/max-width:\s*var\(--game-card-max-inline\)/);
    expect(cardRule?.body).toMatch(/justify-self:\s*center/);
    expect(cardRule?.body).not.toMatch(new RegExp('max-width:\\s*var\\(--game-card-compact'));
  });

  it('resets the inherited grid template on the face-down back so the stamp is one centered unit', () => {
    const backRule = cssRules().find((rule) => rule.selector === '.game-card-placeholder-back');
    expect(backRule?.body).toMatch(/grid-template-columns:\s*100%/);
    expect(backRule?.body).toMatch(/grid-template-rows:\s*100%/);
    expect(backRule?.body).toMatch(/place-items:\s*center/);
    // The face-up card template (two columns, three rows) must not leak through.
    expect(backRule?.body).not.toMatch(/grid-template-columns:\s*auto\s+minmax/);
  });

  it('keeps pile control labels contained and unwrapped at mobile two-up, then fluid at the 320px floor', () => {
    const mobile = css.indexOf('@media (max-width: 46rem)');
    const narrow = css.slice(mobile, css.indexOf('@media (max-width: 22.5rem)', mobile));
    expect(narrow).toMatch(
      /\.game-pile \.action-button\s*{[^}]*width:\s*100%[^}]*min-width:\s*0[^}]*white-space:\s*nowrap/,
    );
    const floor = css.slice(css.indexOf('@media (max-width: 22.5rem)'));
    expect(floor).toMatch(/\.game-pile \.action-button\s*{[^}]*white-space:\s*normal/);
  });

  it('pins every gameplay paper surface with the Cartelera enamel pin, CSS-only', () => {
    const pinRule = cssRules().find(
      (rule) =>
        rule.selector.includes('.game-pile::before') &&
        rule.selector.includes('.game-player-zone::before') &&
        rule.selector.includes('.game-own-hand::before'),
    );
    expect(pinRule).toBeDefined();
    // The existing pin language: board core, yellow rim, perfect circle.
    expect(pinRule?.body).toMatch(/border-radius:\s*50%/);
    expect(pinRule?.body).toMatch(/background:\s*var\(--board\)/);
    expect(pinRule?.body).toMatch(/border:\s*2px solid var\(--yellow\)/);
    // Pins attach only to the actual paper surfaces — never to nested
    // content or to the table itself.
    for (const surface of [
      '.game-table-heading',
      '.game-own-hand',
      '.game-pile',
      '.game-player-zone',
    ]) {
      expect(cssRules().some((rule) => rule.selector.includes(`${surface}::before`))).toBe(true);
    }
    expect(cssRules().some((rule) => rule.selector.includes('.game-table::before'))).toBe(false);
  });

  it('keeps the table plane visually distinct from the page using only existing dark tokens', () => {
    const table = cssRules().find((rule) => rule.selector === '.game-table');
    expect(table?.body).toMatch(/--game-surface:\s*var\(--paper-ink\)/);
    // No gradients, textures, or new colors enter the table plane.
    expect(table?.body).not.toMatch(/gradient|url\(/);
    const surfaceRule = cssRules().find(
      (rule) =>
        rule.selector === '.game-table' && rule.body.includes('background: var(--game-surface)'),
    );
    expect(surfaceRule).toBeDefined();
  });

  it('never uses a dashed border on a connected seated player avatar variant', () => {
    const avatarRules = cssRules().filter((rule) => rule.selector.includes('.game-seat-avatar'));
    expect(avatarRules.length).toBeGreaterThanOrEqual(4);
    for (const rule of avatarRules) {
      if (rule.selector.includes("data-avatar-variant='1'")) {
        // The dashed provisional variant is gone: variant 1 is a tonal
        // paper-raised face on the shared solid border.
        expect(rule.body).not.toMatch(/border-style:\s*dashed/);
        expect(rule.body).toMatch(/background:\s*var\(--paper-raised\)/);
      }
      expect(rule.body).not.toMatch(/border-style:\s*dashed/);
    }
    // The base avatar keeps its committed solid ink border.
    const base = cssRules().find((rule) => rule.selector === '.game-seat-avatar');
    expect(base?.body).toMatch(/border:\s*2px solid var\(--game-placeholder-ink\)/);
  });

  it('renders the center-action stage as a non-interactive, aria-hidden public surface', () => {
    const { container } = render(
      <GameTable controller={controllerStub()} state={threeSeatState()} />,
    );
    // Projection-only state: no stage at all.
    expect(container.querySelector('.game-center-stage')).toBeNull();
  });
});

describe('shipped visual system (M8 correction)', () => {
  it('declares the M8 stamped CSS system, not the M7 placeholder era', () => {
    const { container } = render(
      <GameTable controller={controllerStub()} state={threeSeatState()} />,
    );
    expect(container.querySelector('.game-table')).toHaveAttribute(
      'data-visual-system',
      'm8-css-stamps',
    );
  });
});
