export const DISTRICT_COLORS = [0x8199bf, 0xc1a57d, 0x81b8d1, 0x9c95c8, 0xc293b3, 0x78b9aa];
export const CATEGORY_COLORS: Record<string, number> = {
  electronics: 0x86b7f4, fashion: 0xc69bb8, food: 0xd3b07d, home: 0x9ebc91, books: 0xb5a4d1, games: 0xd29197, beauty: 0xcba6bd, outdoor: 0x80baa9,
};
export const C = {
  honest: 0x8bb8e0, attack: 0xd5879c, blocked: 0x78bbba, breach: 0xe58d9c, falsepos: 0xd9b078, escrow: 0xe0bd82, refund: 0x85c4a8,
  declined: 0xb1a1cf, abandoned: 0x8294ad, injection: 0xb29bc9, neutral: 0xdfe8f4,
};
export const hexCss = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
