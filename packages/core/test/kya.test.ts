import { describe, expect, it } from 'vitest';
import { deriveKey, signRequest, SignatureVerifier, Passport, CryptoMode } from '../src/index';

for (const mode of ['ed25519', 'modeled'] as CryptoMode[]) {
  describe(`Web Bot Auth (${mode})`, () => {
    const key = deriveKey('seed', 'agent-1', mode);
    const passport: Passport = { agentId: 'agent-1', keyId: key.keyId, publicKey: key.publicKey, ownerPayerId: 'P1', address: 'x', issuedAt: 0, mandate: { maxPerOrder: 100, categories: [] } };
    const dir = () => new Map([[key.keyId, { passport, secret: mode === 'modeled' ? key.secret : undefined }]]);
    const req = () => signRequest({ method: 'POST', authority: 'shop.example', path: '/checkout', body: '{"amount":10}' }, key, 'https://agents.example/dir', 1000, 'n1', mode);

    it('accepts a valid signature', () => {
      expect(new SignatureVerifier(dir(), mode).verify(req(), 1000)).toMatchObject({ ok: true, agentId: 'agent-1' });
    });
    it('rejects replayed nonce', () => {
      const v = new SignatureVerifier(dir(), mode);
      const r = req();
      expect(v.verify(r, 1000).ok).toBe(true);
      expect(v.verify(r, 1001).failure).toBe('replayed_nonce');
    });
    it('rejects tampered body', () => {
      const r = req();
      r.body = '{"amount":9999}';
      expect(new SignatureVerifier(dir(), mode).verify(r, 1000).failure).toBe('digest_mismatch');
    });
    it('rejects tampered body with recomputed digest', async () => {
      const { contentDigest } = await import('../src/kya');
      const r = req();
      r.body = '{"amount":9999}';
      r.headers['content-digest'] = contentDigest(r.body);
      expect(new SignatureVerifier(dir(), mode).verify(r, 1000).failure).toBe('bad_signature');
    });
    it('rejects expired and unknown keys', () => {
      expect(new SignatureVerifier(dir(), mode).verify(req(), 1000 + 300 + 31).failure).toBe('expired');
      expect(new SignatureVerifier(new Map(), mode).verify(req(), 1000).failure).toBe('unknown_key');
    });
  });
}
