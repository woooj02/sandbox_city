import { describe, expect, it } from 'vitest';
import { INVARIANT_FLOOR } from '@sandbox-city/core';
import { frozenRulebooks } from '../src/checkout-api';

describe('the rulebooks a checkout call can ask for', () => {
  const books = frozenRulebooks();

  it('includes every rulebook the decision page can recommend', () => {
    for (const name of ['frozen-v4', 'frozen-v3', 'frozen-v2', 'frozen-v1-safeguards']) expect(books[name], name).toBeDefined();
  });

  it('keeps v1 as it was frozen, and only adds the safeguards to the round-four version', () => {
    expect(books['frozen-v1'].enforceMandate).toBe(false);
    expect(books['frozen-v1-safeguards']).toEqual({ ...books['frozen-v1'], ...INVARIANT_FLOOR });
  });
});
