/**
 * Places point labels so that none overlaps another label or a point. Fixed labels (a column, say) are placed first;
 * each free label then takes the first spot around its point that is clear and inside the plot. Sizes are in the
 * chart's own viewBox units, so one placement holds at every screen width.
 */
export interface Box { l: number; r: number; t: number; b: number }
export interface Placed { x: number; y: number; anchor: 'start' | 'end' | 'middle' }

// 13px UI text measures about 5.9 units a character; a little over, so an estimate never undercounts
const CHAR = 6.4, LINE = 14;

export function labelBox(p: Placed, text: string): Box {
  const w = text.length * CHAR, l = p.anchor === 'end' ? p.x - w : p.anchor === 'middle' ? p.x - w / 2 : p.x;
  return { l, r: l + w, t: p.y - LINE + 3, b: p.y + 4 };
}

export const overlaps = (a: Box, b: Box) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

export function placeLabels(
  points: { key: string; x: number; y: number; text: string }[],
  fixed: Box[], bounds: { l: number; r: number; t: number; b: number },
): Map<string, Placed> {
  const taken = [...fixed, ...points.map((p) => ({ l: p.x - 7, r: p.x + 7, t: p.y - 7, b: p.y + 7 }))];
  const out = new Map<string, Placed>();
  for (const p of points) {
    const spots: Placed[] = [
      { x: p.x + 11, y: p.y - 8, anchor: 'start' }, { x: p.x + 11, y: p.y + 18, anchor: 'start' },
      { x: p.x - 11, y: p.y - 8, anchor: 'end' }, { x: p.x - 11, y: p.y + 18, anchor: 'end' },
      { x: p.x, y: p.y - 14, anchor: 'middle' }, { x: p.x, y: p.y + 26, anchor: 'middle' },
      { x: p.x + 11, y: p.y - 24, anchor: 'start' }, { x: p.x + 11, y: p.y + 34, anchor: 'start' },
      { x: p.x - 11, y: p.y - 24, anchor: 'end' }, { x: p.x - 11, y: p.y + 34, anchor: 'end' },
      { x: p.x, y: p.y - 30, anchor: 'middle' }, { x: p.x, y: p.y + 42, anchor: 'middle' },
    ];
    const inside = (b: Box) => b.l >= bounds.l && b.r <= bounds.r && b.t >= bounds.t && b.b <= bounds.b;
    // no clear spot: the one inside the plot that touches the fewest others
    const hits = (s: Placed) => taken.filter((t) => overlaps(labelBox(s, p.text), t)).length;
    const pick = spots.find((s) => { const b = labelBox(s, p.text); return inside(b) && !taken.some((t) => overlaps(b, t)); })
      ?? spots.filter((s) => inside(labelBox(s, p.text))).sort((a, b) => hits(a) - hits(b))[0] ?? spots[0];
    out.set(p.key, pick);
    taken.push(labelBox(pick, p.text));
  }
  return out;
}
