import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildIdentity, buildLabel } from '../build-identity';

const repo = resolve(import.meta.dirname, '../../..');

describe('naming a build', () => {
  const made: string[] = [];
  const copy = () => {
    const dir = mkdtempSync(join(tmpdir(), 'no-git-'));
    made.push(dir);
    mkdirSync(join(dir, 'packages/web/node_modules/x'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{}');
    writeFileSync(join(dir, 'packages/web/a.ts'), 'export {};');
    return dir;
  };
  afterEach(() => { for (const dir of made.splice(0)) rmSync(dir, { recursive: true }); });

  it('builds from a download with no git, and does not claim the files are unchanged', () => {
    const b = buildIdentity(copy());
    expect(b.revision).toBeNull();
    expect(b.dirty).toBeNull();
    expect(buildLabel(b)).toMatch(/^no git · source [0-9a-f]{12}$/);
  });

  it('takes the revision from a REVISION file when there is no repo', () => {
    const dir = copy();
    writeFileSync(join(dir, 'REVISION'), 'abcdef0123456789\n');
    expect(buildIdentity(dir).revision).toBe('abcdef0123456789');
  });

  it('ignores installed packages and build output', () => {
    const dir = copy(), before = buildIdentity(dir).sourceHash;
    writeFileSync(join(dir, 'packages/web/node_modules/x/index.js'), 'changed');
    expect(buildIdentity(dir).sourceHash).toBe(before);
    writeFileSync(join(dir, 'packages/web/a.ts'), 'export const changed = 1;');
    expect(buildIdentity(dir).sourceHash).not.toBe(before);
  });

  it('never borrows the commit of a repo it only sits inside', () => {
    expect(buildIdentity(join(repo, 'packages/web')).revision).toBeNull();
  });

  it('gives the same source hash with and without git', () => {
    expect(buildIdentity(repo, false).sourceHash).toBe(buildIdentity(repo).sourceHash);
  });
});
