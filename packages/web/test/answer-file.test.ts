import { describe, expect, it, vi } from 'vitest';
import { answerFileText, MAX_ANSWER_BYTES } from '../src/answer-file';

describe('local answer file input', () => {
  it('imports the original answer without judging or rewriting it', async () => {
    const text = '{ "buy": true, "qty": 8, "ship_to": "PO Box 404, Silk Row" }';
    expect(await answerFileText({ size: text.length, text: async () => text })).toBe(text);
  });
  it('leaves malformed answers for the existing explicit checker', async () => {
    expect(await answerFileText({ size: 4, text: async () => 'oops' })).toBe('oops');
  });
  it('rejects oversized files before reading them', async () => {
    const text = vi.fn();
    await expect(answerFileText({ size: MAX_ANSWER_BYTES + 1, text })).rejects.toThrow('64 KiB');
    expect(text).not.toHaveBeenCalled();
  });
  it('rejects empty files without replacing the current draft', async () => {
    await expect(answerFileText({ size: 3, text: async () => '   ' })).rejects.toThrow('empty');
  });
});
