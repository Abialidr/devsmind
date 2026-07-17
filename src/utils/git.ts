import { execSync } from 'child_process';

/**
 * Local git-shelling helpers for `devsmind analyze`. Never throw — a missing git
 * binary, a repo path that isn't a git repo, or an empty history are all treated
 * as "nothing to report" rather than a hard failure, since analyze must still run
 * its non-git checks even when git is unavailable.
 */

export interface RenamedFile {
  from: string;
  to: string;
}

/** Files renamed (via `git log`'s rename detection) since `sinceIso`, deduped by destination path. */
export function getRenamedFilesSince(repoPath: string, sinceIso: string): RenamedFile[] {
  const out = runGit(repoPath, `log --since="${sinceIso}" --name-status --diff-filter=R --pretty=format:`);
  if (!out) return [];

  const byTo = new Map<string, RenamedFile>();
  for (const line of out.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('R')) continue;
    const parts = trimmed.split('\t');
    if (parts.length < 3) continue;
    const [, from, to] = parts;
    if (from && to) byTo.set(to, { from, to });
  }
  return Array.from(byTo.values());
}

/** Distinct file paths touched by any commit since `sinceIso`. */
export function getChangedFilesSince(repoPath: string, sinceIso: string): string[] {
  const out = runGit(repoPath, `log --since="${sinceIso}" --name-only --pretty=format:`);
  if (!out) return [];
  return Array.from(new Set(out.split('\n').map(l => l.trim()).filter(Boolean)));
}

function runGit(repoPath: string, args: string): string {
  try {
    // stdio: pipe on all three streams — a non-repo/no-git "fatal: ..." is an EXPECTED,
    // silently-handled case here (falls back to an empty result), not something worth
    // leaking to the user's terminal on every sync/analyze run.
    return execSync(`git ${args}`, { cwd: repoPath, encoding: 'utf-8', maxBuffer: 1024 * 1024 * 32, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}
