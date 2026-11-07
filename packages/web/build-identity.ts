import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SOURCES = ['packages', 'scripts', 'package.json', 'package-lock.json', 'docs/AGENT_LAB_GUIDE.md'];
const IGNORED = new Set(['node_modules', 'dist', 'runs', '.data', '.env', '.DS_Store']);

/** Null when there is no usable repo here: a ZIP download, a server copy, or a folder inside someone else's repo. */
function fromGit(root: string) {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    if (realpathSync(git('rev-parse', '--show-toplevel')) !== realpathSync(root)) return null;
    const files = git('ls-files', '-co', '--exclude-standard', '--', ...SOURCES).split('\n').filter((f) => existsSync(join(root, f)));
    return { revision: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain').length > 0, files };
  } catch {
    return null;
  }
}

function walk(root: string, path: string): string[] {
  const full = join(root, path);
  if (!existsSync(full)) return [];
  if (!statSync(full).isDirectory()) return [path];
  return readdirSync(full).filter((n) => !IGNORED.has(n) && !n.endsWith('.log')).flatMap((n) => walk(root, `${path}/${n}`));
}

/** Names what was built. Without git nobody can say whether the files were changed, so `dirty` is null, not false. */
export function buildIdentity(root: string, useGit = true) {
  const repo = useGit ? fromGit(root) : null;
  const stamped = join(root, 'REVISION');
  const revision = repo?.revision ?? (existsSync(stamped) ? readFileSync(stamped, 'utf8').trim() : null);
  const hash = createHash('sha256');
  for (const file of (repo?.files ?? SOURCES.flatMap((s) => walk(root, s))).sort()) hash.update(file).update(readFileSync(join(root, file)));
  return { revision, dirty: repo ? repo.dirty : null, sourceHash: hash.digest('hex'), builtAt: new Date().toISOString() };
}

export const buildLabel = (b: ReturnType<typeof buildIdentity>) => `${b.revision?.slice(0, 7) ?? 'no git'}${b.dirty ? ' + local changes' : ''} · source ${b.sourceHash.slice(0, 12)}`;
