export const DISTRICT_COLORS = [0xff2e88, 0xffb347, 0x4cf2ff, 0x7a5cff, 0xff6ad5, 0x3dffb5];
export const CATEGORY_COLORS: Record<string, number> = {
  electronics: 0x4cf2ff, fashion: 0xff5ec4, food: 0xffb84c, home: 0x9dff6a, books: 0xb28cff, games: 0xff6b6b, beauty: 0xff9de2, outdoor: 0x5effc8,
};
export const C = {
  honest: 0x6ff7ff, attack: 0xff2e6e, blocked: 0x4cf2ff, breach: 0xff1744, falsepos: 0xffb020, escrow: 0xffd84c, refund: 0x7dff9a,
  declined: 0xb28cff, abandoned: 0x8890b0, injection: 0xff3df2, neutral: 0xdfe8ff,
};
export const hexCss = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
