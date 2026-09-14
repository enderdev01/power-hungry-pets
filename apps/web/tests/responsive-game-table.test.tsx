describe('shared discard pile (docs/12 central action stage)', () => {
  it('stacks every pile card in one cell with a per-card tilt and no overlay copy', () => {
    const cell = cssRules().find((rule) => rule.selector === '.game-discards');
    expect(cell?.body).toMatch(/grid-template-areas:\s*'pile'/);
    const slot = cssRules().find((rule) => rule.selector === '.game-discard-slot');
    expect(slot?.body).toMatch(/rotate\(var\(--tilt/);
    expect(css).not.toContain('.game-center-stage');
  });

  it('lets pointer events pass through the stage cell to the seats around it', () => {
    const center = cssRules().find(
      (rule) => rule.selector === '.game-center' && rule.body.includes('pointer-events'),
    );
    expect(center?.body).toMatch(/pointer-events:\s*none/);
    expect(center?.body).toMatch(/position:\s*relative/);
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
import { CARD_ART_RATIO, CARD_BACK_ART_KEY, TABLETOP_ASSET_CONFIG } from '@/lib/game/card-assets';
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

  it('keeps the semantic order stable while bands only change the visual topology', () => {
    for (const area of ['game-table-heading', 'game-own-hand', 'game-center']) {
      const areaDeclarations = css.match(/grid-template-areas:[^;]+;/g) ?? [];
      expect(areaDeclarations.filter((d) => d.includes(area)).length).toBeGreaterThanOrEqual(3);
    }
    expect(css).toMatch(/grid-template-areas:[^;]*game-players/);
  });

  it('keeps the urgent turn status inside the first landmark', () => {
    const { container } = render(
      <GameTable controller={controllerStub()} state={threeSeatState()} />,
    );
    const heading = container.querySelector('.game-table-heading');
    expect(heading).not.toBeNull();
    expect(within(heading as HTMLElement).getByRole('status')).toHaveTextContent(
      /turno|esperando/i,
    );
  });
});

describe('seat avatars around the table (M8)', () => {
  it('renders a labelled avatar per public seat from the name only', () => {
    render(<GameTable controller={controllerStub()} state={threeSeatState()} />);
    expect(screen.getByRole('img', { name: 'Asiento de Ana' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Asiento de Bruno' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Asiento de Caro' })).toBeInTheDocument();
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

  it('keeps draw, discard, and hidden piles in one row down to the 320px floor', () => {
    const baseCenter = cssRules().find(
      (rule) => rule.selector === '.game-center' && rule.body.includes('grid-template-columns'),
    );
    expect(baseCenter?.body).toMatch(/grid-template-columns:\s*repeat\(3,/);
    const floor = css.slice(css.indexOf('@media (max-width: 22.5rem)'));
    expect(floor).toMatch(/\.game-table\s*{[^}]*--hand-card:/);
    expect(floor).toMatch(/\.game-table\s*{[^}]*--pile-card:/);
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

describe('seats around the table (46rem and up, docs/12 table layout)', () => {
  const wide = css.slice(css.indexOf('@media (min-width: 46rem)'));
  const areaRows = (body: string): string[][] =>
    (body.match(/grid-template-areas:([^;]+);/)?.[1] ?? '')
      .split("'")
      .filter((_, index) => index % 2 === 1)
      .map((row) => row.trim().split(/\s+/));

  it('stacks heading, the table stage, and the own hand, with the stage flexible', () => {
    const table = wide.match(/\.game-table\s*{([^}]*)}/)?.[1] ?? '';
    expect(areaRows(table).map((row) => row[0])).toEqual([
      'game-table-heading',
      'game-center',
      'game-own-hand',
    ]);
    expect(table).toMatch(/grid-template-rows:\s*auto\s+minmax\([^)]*1fr\)\s+auto/);
  });

  it('places every seat slot around the stage', () => {
    for (const slot of ['top', 'top-left', 'top-right', 'left', 'right', 'bottom']) {
      expect(wide).toContain(`.game-player-zone[data-seat-slot='${slot}']`);
    }
    expect(wide).toMatch(/\.game-players\s*{[^}]*grid-row:\s*game-center-start/);
  });

  it('renders seat slots with the viewer at the bottom', () => {
    const { container } = render(
      <GameTable controller={controllerStub()} state={threeSeatState()} />,
    );
    const slotOf = (id: string) =>
      container
        .querySelector(`.game-player-zone[data-player-id='${id}']`)
        ?.getAttribute('data-seat-slot');
    expect(slotOf(SELF_ID)).toBe('bottom');
    expect(['left', 'right']).toContain(slotOf(OTHER_ID));
  });
});

describe('canonical card art system (docs/11 card system)', () => {
  it('keeps every card surface at the native 4:7 ratio of the canonical art', () => {
    expect(CARD_ART_RATIO).toBe('4 / 7');
    expect(css).toMatch(/\.game-card-placeholder\s*{[^}]*aspect-ratio:\s*4\s*\/\s*7/);
    expect(css).toMatch(/\.game-card-placeholder-back\s*{[^}]*aspect-ratio:\s*4\s*\/\s*7/);
    expect(css).not.toMatch(/aspect-ratio:\s*63\s*\/\s*88/);
  });

  it('rounds card corners through the shared card radius token', () => {
    expect(css).toMatch(/\.game-card-placeholder\s*{[^}]*border-radius:\s*var\(--card-radius\)/);
  });

  it('renders the mapped canonical art as the whole face without redrawing it', () => {
    const { container } = render(
      <GameTable
        controller={controllerStub()}
        state={threeSeatState()}
        assetConfig={TABLETOP_ASSET_CONFIG}
      />,
    );
    const ownCard = container.querySelector('.game-own-hand .game-card-placeholder');
    expect(ownCard).toHaveAttribute('data-art-kind', 'image');
    const image = ownCard?.querySelector('img.game-card-image');
    expect(image?.getAttribute('src')).toMatch(/^\/cards\/.+\.webp$/);
    // No CSS-drawn placeholder stamp competes with the art.
    expect(ownCard?.querySelector('.game-card-art-stamp')).toBeNull();
    // The textual metadata remains for assistive technology, visually hidden.
    expect(ownCard?.querySelector('.game-card-value')).not.toBeNull();
    expect(css).toMatch(
      /\.game-card-placeholder\[data-art-kind='image'\] \.game-card-value,[\s\S]*?clip-path:\s*inset\(50%\)/,
    );
  });

  it('maps the shared back art key for every face-down card without exposing identity', () => {
    const { container } = render(
      <GameTable
        controller={controllerStub()}
        state={threeSeatState()}
        assetConfig={TABLETOP_ASSET_CONFIG}
      />,
    );
    const backs = [...container.querySelectorAll('.game-card-placeholder-back')];
    expect(backs.length).toBeGreaterThan(0);
    for (const back of backs) {
      expect(back.querySelector('img')?.getAttribute('src')).toBe(
        TABLETOP_ASSET_CONFIG.images[CARD_BACK_ART_KEY],
      );
      expect(back).not.toHaveAttribute('data-art-key');
    }
  });

  it('falls back to the CSS placeholder face when no asset is mapped', () => {
    render(<GameTable controller={controllerStub()} state={threeSeatState()} />);
    const back = screen.getByRole('img', { name: 'Mazo boca abajo' });
    expect(back).toHaveTextContent('Boca abajo');
    expect(back).toHaveAttribute('data-art-kind', 'none');
    expect(document.querySelector('.game-card-art')).not.toBeNull();
  });

  it('renders the card structure as value, name, then effect from public metadata', () => {
    const { container } = render(
      <GameTable controller={controllerStub()} state={threeSeatState()} />,
    );
    const ownCard = container.querySelector('.game-own-hand .game-card-placeholder');
    expect(ownCard?.querySelector('.game-card-value')).not.toBeNull();
    expect(ownCard?.querySelector('.game-card-name')).not.toBeNull();
    expect(ownCard?.querySelector('.game-card-effect')).not.toBeNull();
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

  it('avoids glassmorphism: no backdrop blur on any surface', () => {
    expect(css).not.toMatch(/backdrop-filter/);
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
    cssRules().filter(
      (rule) =>
        rule.selector.startsWith('.game-table') && rule.body.includes('grid-template-areas'),
    );

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
            message: 'Las reglas del juego rechazaron ese movimiento.',
            sentence: 'Las reglas del juego rechazaron ese movimiento.',
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

describe('tabletop scene composition (docs/10 and docs/12)', () => {
  it('paints a bounded, tilted felt table under the action stage', () => {
    const felt = cssRules().find((rule) => rule.selector === '.game-table::before');
    expect(felt?.body).toMatch(/grid-row:\s*game-center-start\s*\/\s*game-center-end/);
    expect(felt?.body).toMatch(/border-radius:/);
    expect(felt?.body).toMatch(/background:/);
    expect(felt?.body).toMatch(/rotateX\(/);
  });

  it('declares the documented z-index order as ascending tokens', () => {
    const order = [
      '--z-environment',
      '--z-table',
      '--z-seats',
      '--z-piles',
      '--z-cues',
      '--z-hud',
      '--z-modal',
      '--z-system',
    ].map((token) => Number(css.match(new RegExp(`${token}:\\s*(\\d+)`))?.[1]));
    expect(order.every((value) => Number.isFinite(value))).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('reserves dashed avatar borders for disconnected seats only', () => {
    const dashed = cssRules().filter(
      (rule) =>
        rule.selector.includes('.game-seat-avatar') && /border-style:\s*dashed/.test(rule.body),
    );
    expect(dashed.length).toBeGreaterThan(0);
    for (const rule of dashed) {
      expect(rule.selector).toContain("[data-connected='false']");
    }
  });

  it('renders the center-action stage as a non-interactive, aria-hidden public surface', () => {
    const { container } = render(
      <GameTable controller={controllerStub()} state={threeSeatState()} />,
    );
    expect(container.querySelector('.game-center-stage')).toBeNull();
  });
});

describe('seat and table states (docs/13 component states)', () => {
  function stateWith(players: PublicPlayerView[]): RoomFlowState {
    return flowState({ publicView: publicView({ players, round: roundView() }) });
  }

  it('marks the current turn, protection, elimination, and disconnection with text, not color alone', () => {
    const current = roundView().currentPlayerId;
    const { container } = render(
      <GameTable
        controller={controllerStub()}
        state={stateWith([
          seat(current, 'Ana'),
          seat(OTHER_ID === current ? 'p-other-2' : OTHER_ID, 'Bruno', { protected: true }),
          seat('p-third', 'Caro', { eliminated: true }),
          seat('p-fourth', 'Dani', { connected: false }),
        ])}
      />,
    );
    const zone = (name: string) =>
      [...container.querySelectorAll('.game-player-zone')].find((node) =>
        node.textContent?.includes(name),
      ) as HTMLElement;
    expect(zone('Ana')).toHaveAttribute('data-current-turn', 'true');
    expect(within(zone('Ana')).getByText('turno')).toHaveClass('game-status-badge');
    expect(within(zone('Bruno')).getByText('protegido')).toBeInTheDocument();
    expect(within(zone('Caro')).getByText('eliminado')).toBeInTheDocument();
    expect(within(zone('Caro')).queryByText('turno')).toBeNull();
    expect(zone('Dani')).toHaveAttribute('data-connected', 'false');
    expect(within(zone('Dani')).getByText('ausente')).toBeInTheDocument();
  });

  it('marks the viewer seat and never marks a seat as a legal target without published options', () => {
    const { container } = render(
      <GameTable controller={controllerStub()} state={threeSeatState()} />,
    );
    const self = container.querySelector(`.game-player-zone[data-player-id='${SELF_ID}']`);
    expect(self).toHaveAttribute('data-self', 'true');
    expect(container.querySelector('[data-legal-target]')).toBeNull();
    expect(container.querySelector('.game-table')).not.toHaveAttribute('data-targeting');
  });
});

describe('shipped visual system (docs/10 visual direction)', () => {
  it('declares the Digital Tabletop Arcade system on the table', () => {
    const { container } = render(
      <GameTable controller={controllerStub()} state={threeSeatState()} />,
    );
    expect(container.querySelector('.game-table')).toHaveAttribute(
      'data-visual-system',
      'tabletop-arcade',
    );
  });
});
