/**
 * Direction-contract placement: the approved visual direction must exist in
 * the live DOM as a direct comment child of <body> — no wrapper element —
 * keeping the exact seed key and FINISH sentence.
 */
import { render } from '@testing-library/react';
import { DirectionContractComment } from '@/components/direction-contract';

const FINISH =
  'unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance';

describe('direction contract comment', () => {
  it('is a direct comment child of body, not inside any wrapper element', () => {
    render(<DirectionContractComment />);
    const contract = document.body.firstChild;
    expect(contract).not.toBeNull();
    expect(contract?.nodeType).toBe(8 /* COMMENT_NODE */);
    expect(contract?.parentNode).toBe(document.body);
    expect(contract?.nodeValue).toContain('9719d81e');
    expect(contract?.nodeValue).toContain(FINISH);
  });

  it('inserts no element as its first body child', () => {
    render(<DirectionContractComment />);
    expect(document.body.firstElementChild).not.toBe(document.body.firstChild);
    expect(document.body.firstChild?.nodeType).toBe(8);
  });

  it('stays a single comment across rerenders', () => {
    const { rerender } = render(<DirectionContractComment />);
    rerender(<DirectionContractComment />);
    const contracts = Array.from(document.body.childNodes).filter(
      (node) => node.nodeType === 8 && (node.nodeValue ?? '').includes('9719d81e'),
    );
    expect(contracts).toHaveLength(1);
  });
});
