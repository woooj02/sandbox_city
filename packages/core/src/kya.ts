/**
 * KYA — Know Your Agent.
 *
 * Agent passports bind an agent signing key to a verified human owner (Log In with PayPal payer id)
 * plus an owner-signed mandate. Every agent request is signed with HTTP Message Signatures
 * (RFC 9421) using the Web Bot Auth profile (tag="web-bot-auth"), the same primitive Visa TAP and
 * Mastercard Agent Pay build on.
 *
 * crypto: 'ed25519' does the real curve math. 'modeled' keeps the exact same verification logic
 * (key lookup, created/expires window, nonce replay cache, content-digest) but swaps the curve for
 * a keyed hash so headless evolutionary runs stay fast. Decisions are identical in both modes.
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import type { Passport, SignedRequest } from './types';

export type CryptoMode = 'ed25519' | 'modeled';

const enc = new TextEncoder();
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function b64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    out += B64[a >> 2] + B64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? '=' : B64[c & 63];
  }
  return out;
}
export function unb64(s: string): Uint8Array {
  const clean = s.replace(/=+$/, '');
  const out: number[] = [];
  let buf = 0, bits = 0;
  for (const ch of clean) {
    buf = (buf << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 255); }
  }
  return new Uint8Array(out);
}
export const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export const unhex = (s: string) => new Uint8Array(s.match(/.{2}/g)!.map((h) => parseInt(h, 16)));

export function contentDigest(body: string): string {
  return `sha-256=:${b64(sha256(enc.encode(body)))}:`;
}

export interface KeyPair { keyId: string; secret: Uint8Array; publicKey: string }

/** Deterministic key derivation so a seeded world is reproducible bit-for-bit. */
export function deriveKey(seed: string, agentId: string, mode: CryptoMode): KeyPair {
  const secret = sha256(enc.encode(`sandbox-city/key/${seed}/${agentId}`));
  const publicKey = mode === 'ed25519' ? hex(ed25519.getPublicKey(secret)) : hex(sha256(secret));
  // JWK thumbprint-style key id
  const keyId = b64(sha256(enc.encode(publicKey))).slice(0, 22).replace(/[+/]/g, '_');
  return { keyId, secret, publicKey };
}

const COVERED = ['"@method"', '"@authority"', '"@path"', '"content-digest"', '"signature-agent"'];

function signatureBase(req: SignedRequest, params: string): string {
  return [
    `"@method": ${req.method}`,
    `"@authority": ${req.authority}`,
    `"@path": ${req.path}`,
    `"content-digest": ${req.headers['content-digest']}`,
    `"signature-agent": ${req.headers['signature-agent']}`,
    `"@signature-params": ${params}`,
  ].join('\n');
}

function rawSign(base: string, key: KeyPair, mode: CryptoMode): Uint8Array {
  const msg = enc.encode(base);
  if (mode === 'ed25519') return ed25519.sign(msg, key.secret);
  return sha256(new Uint8Array([...key.secret, ...msg]));
}

export function signRequest(
  req: Omit<SignedRequest, 'headers'> & { headers?: Record<string, string> },
  key: KeyPair,
  agentDirectory: string,
  now: number,
  nonce: string,
  mode: CryptoMode,
  ttl = 300,
): SignedRequest {
  const headers: Record<string, string> = {
    ...(req.headers ?? {}),
    'content-type': 'application/json',
    'content-digest': contentDigest(req.body),
    'signature-agent': `"${agentDirectory}"`,
  };
  const params = `(${COVERED.join(' ')});created=${now};expires=${now + ttl};keyid="${key.keyId}";nonce="${nonce}";tag="web-bot-auth"`;
  const full: SignedRequest = { ...req, headers };
  const sig = rawSign(signatureBase(full, params), key, mode);
  headers['signature-input'] = `sig1=${params}`;
  headers['signature'] = `sig1=:${b64(sig)}:`;
  return full;
}

export type VerifyFailure =
  | 'missing_signature' | 'unknown_key' | 'expired' | 'not_yet_valid' | 'replayed_nonce'
  | 'digest_mismatch' | 'bad_signature' | 'wrong_tag';

export interface VerifyResult { ok: boolean; failure?: VerifyFailure; keyId?: string; agentId?: string }

/** Verifier side: a merchant / gateway holding the public passport directory. */
export class SignatureVerifier {
  private nonces = new Map<string, number>();
  constructor(
    private directory: Map<string, { passport: Passport; secret?: Uint8Array }>,
    private mode: CryptoMode,
    public skew = 30,
  ) {}

  verify(req: SignedRequest, now: number): VerifyResult {
    const input = req.headers['signature-input'];
    const sigH = req.headers['signature'];
    if (!input || !sigH) return { ok: false, failure: 'missing_signature' };
    const params = input.replace(/^sig1=/, '');
    const get = (k: string) => params.match(new RegExp(`;${k}=("?)([^;"]*)\\1`))?.[2];
    const keyId = get('keyid')!, created = Number(get('created')), expires = Number(get('expires'));
    const nonce = get('nonce')!, tag = get('tag');
    if (tag !== 'web-bot-auth') return { ok: false, failure: 'wrong_tag', keyId };
    const entry = this.directory.get(keyId);
    if (!entry) return { ok: false, failure: 'unknown_key', keyId };
    if (created > now + this.skew) return { ok: false, failure: 'not_yet_valid', keyId };
    if (expires < now - this.skew) return { ok: false, failure: 'expired', keyId };
    if (req.headers['content-digest'] !== contentDigest(req.body)) return { ok: false, failure: 'digest_mismatch', keyId };
    const sig = unb64(sigH.replace(/^sig1=:/, '').replace(/:$/, ''));
    const base = signatureBase(req, params);
    let valid: boolean;
    if (this.mode === 'ed25519') {
      try { valid = ed25519.verify(sig, enc.encode(base), unhex(entry.passport.publicKey)); } catch { valid = false; }
    } else {
      // modeled: verifier recomputes the keyed hash (equivalent decision, no curve math)
      valid = !!entry.secret && b64(sha256(new Uint8Array([...entry.secret, ...enc.encode(base)]))) === b64(sig);
    }
    if (!valid) return { ok: false, failure: 'bad_signature', keyId };
    const nk = `${keyId}:${nonce}`;
    if (this.nonces.has(nk)) return { ok: false, failure: 'replayed_nonce', keyId };
    this.nonces.set(nk, expires);
    if (this.nonces.size > 50_000) for (const [k, exp] of this.nonces) if (exp < now - this.skew) this.nonces.delete(k);
    return { ok: true, keyId, agentId: entry.passport.agentId };
  }
}
