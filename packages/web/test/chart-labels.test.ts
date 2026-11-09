import { describe, expect, it } from 'vitest';
import { labelBox, overlaps, placeLabels } from '../src/chart-labels';

const bounds = { l: 0, r: 760, t: 0, b: 260 };
const boxes = (pts: { key: string; x: number; y: number; text: string }[], fixed = []) => { const m = placeLabels(pts, fixed, bounds); return pts.map((p) => labelBox(m.get(p.key)!, p.text)); };
const clear = (bs: ReturnType<typeof boxes>) => bs.every((a, i) => bs.every((b, j) => i === j || !overlaps(a, b)));

describe('chart labels', () => {
  it('separates two points that sit almost on each other', () => {
    expect(clear(boxes([{ key: 'a', x: 500, y: 120, text: 'Simple limits + safeguards' }, { key: 'b', x: 506, y: 122, text: 'Hand-written + safeguards' }]))).toBe(true);
  });

  it('keeps clear of labels that were placed first', () => {
    const fixed = [labelBox({ x: 560, y: 125, anchor: 'start' }, 'Hand-written + safeguards')];
    const [b] = boxes([{ key: 'a', x: 600, y: 120, text: 'Simple limits + safeguards' }], fixed as never);
    expect(overlaps(b, fixed[0])).toBe(false);
  });

  it('stays inside the plot near the right edge', () => {
    const [b] = boxes([{ key: 'a', x: 740, y: 100, text: 'Wild West + safeguards' }]);
    expect(b.r).toBeLessThanOrEqual(760);
  });

  it('the case an outside review saw: a free label beside a column of labels', () => {
    // positions measured from the rendered chart at 1280 x 720
    const fixed = [['Frozen v4', 20], ['Frozen v3', 37], ['Frozen v1 + safeguards', 54], ['Frozen v2', 71], ['Hand-written + safeguards', 88], ['Lab-Tuned + safeguards', 105]]
      .map(([t, y]) => labelBox({ x: 355, y: y as number, anchor: 'start' }, t as string));
    const m = placeLabels([{ key: 's', x: 573.6, y: 68, text: 'Simple limits + safeguards' }, { key: 'w', x: 661, y: 76, text: 'Wild West + safeguards' }], fixed, { l: 84, r: 756, t: 0, b: 260 });
    const placed = [labelBox(m.get('s')!, 'Simple limits + safeguards'), labelBox(m.get('w')!, 'Wild West + safeguards')];
    expect(clear([...fixed, ...placed])).toBe(true);
  });

  it('places the benchmark arms without any overlap', () => {
    const pts = [['Frozen v4', 300, 50], ['Frozen v3', 296, 52], ['Frozen v1', 304, 51], ['Frozen v2', 340, 80], ['Hand-written + safeguards', 345, 82], ['Simple limits + safeguards', 600, 92], ['Wild West + safeguards', 690, 100], ['Lab-Tuned + safeguards', 350, 84], ['Fortress + safeguards', 150, 200]]
      .map(([text, x, y], i) => ({ key: String(i), text: text as string, x: x as number, y: y as number }));
    expect(clear(boxes(pts))).toBe(true);
  });
});
