import { flyFrom } from '@/components/game/card-flight';

function rect(left: number, top: number, width = 100, height = 175): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

describe('card flights', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('is a no-op where Element.animate is unavailable', () => {
    const element = document.createElement('div');
    expect(() => flyFrom(element, rect(0, 0))).not.toThrow();
  });

  it('flies from the source rectangle and ends on the resting transform', () => {
    const element = document.createElement('div');
    const animate = jest.fn();
    Object.assign(element, { animate });
    jest.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect(500, 500));
    flyFrom(element, rect(100, 900, 50, 87), { flip: true });
    expect(animate).toHaveBeenCalledTimes(1);
    const [frames] = animate.mock.calls[0] as [Array<{ transform: string }>];
    expect(frames[0]!.transform).toContain('translate(-425px, 356px)');
    expect(frames[0]!.transform).toContain('rotateY(180deg)');
    expect(frames[frames.length - 1]!.transform).toBe('none');
  });

  it('skips flights when the viewer prefers reduced motion', () => {
    const element = document.createElement('div');
    const animate = jest.fn();
    Object.assign(element, { animate });
    jest.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect(500, 500));
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: true }),
    });
    flyFrom(element, rect(0, 0));
    expect(animate).not.toHaveBeenCalled();
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: undefined });
  });
});
