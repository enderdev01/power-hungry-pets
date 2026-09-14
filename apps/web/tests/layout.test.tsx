/**
 * Root layout contracts (M8 correction). The Next App Router resolves the
 * `metadata` and `viewport` exports at build/render time — outside jsdom — so
 * these are honest static source contracts: the exported viewport must opt
 * into `viewport-fit: cover` (which is what makes the safe-area env() insets
 * in globals.css effective on notched phones) and the existing page metadata
 * must stay intact.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, '..', 'src', 'app', 'layout.tsx'), 'utf8');

describe('root layout viewport contract (M8 correction)', () => {
  it('exports the Next viewport with viewportFit cover', () => {
    const viewport = source.match(/export\s+const\s+viewport:\s*Viewport\s*=\s*{([\s\S]*?)\n};/);
    expect(viewport).not.toBeNull();
    expect(viewport?.[1]).toMatch(/viewportFit:\s*'cover'/);
  });

  it('keeps the existing page metadata intact', () => {
    expect(source).toMatch(/export\s+const\s+metadata:\s*Metadata\s*=\s*{/);
    expect(source).toContain("title: 'Power Hungry Pets'");
    expect(source).toContain(
      'Una mesa privada en línea para el juego de cartas Power Hungry Pets.',
    );
  });
});
