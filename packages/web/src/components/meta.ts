import type { AttackKind } from '@sandbox-city/core';
export const ATTACK_KANJI: Record<AttackKind, string> = {
  prompt_injection: '注入', fake_store: '偽店', refund_abuse: '返金', card_testing: '盗卡', impersonation: '偽装', fraud_ring: '結託',
};
export const ATTACK_SHORT: Record<AttackKind, string> = {
  prompt_injection: 'Prompt injection', fake_store: 'Fake stores', refund_abuse: 'Refund abuse', card_testing: 'Stolen cards', impersonation: 'Impersonation', fraud_ring: 'Fraud ring',
};
export const money = (n: number, d = 0) => `$${(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
export const pct = (n: number) => `${((n ?? 0) * 100).toFixed(1)}%`;
export const clock = (t: number) => {
  const mins = (t + 6 * 60) % 1440;
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(Math.floor(mins % 60)).padStart(2, '0')}`;
};
export const LANE_NAMES = ['A', 'B'];
