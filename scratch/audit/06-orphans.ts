import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

const DB_PATH = 'C:/work/Hanoot/backend/lamda/harrir-docs-information/harrir-brains/.devmind/brain.db';
const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

const REPOS = [
  'harrir-backend-order-service',
  'harrir-backend-products-service',
  'harrir-backend-user-service',
  'harrir-backend-zoho-service',
  'harrir-express-backend',
  'harrir-mini-app',
  'harrir-web',
  'harrir-web-admin'
];

const REPO_PATHS: Record<string, string> = {
  'harrir-backend-order-service': 'C:/work/Hanoot/backend/lamda/harrir-backend-order-service',
  'harrir-backend-products-service': 'C:/work/Hanoot/backend/lamda/harrir-backend-products-service',
  'harrir-backend-user-service': 'C:/work/Hanoot/backend/lamda/harrir-backend-user-service',
  'harrir-backend-zoho-service': 'C:/work/Hanoot/backend/lamda/harrir-backend-zoho-service',
  'harrir-express-backend': 'C:/work/Hanoot/backend/lamda/harrir-express-backend',
  'harrir-mini-app': 'C:/work/Hanoot/backend/lamda/harrir-mini-app',
  'harrir-web': 'C:/work/Hanoot/backend/lamda/harrir-web',
  'harrir-web-admin': 'C:/work/Hanoot/backend/lamda/harrir-web-admin'
};

function repoOf(nodeId: string): string | null {
  const m = nodeId.match(/^\{([^}]+)\}\//);
  return m ? m[1] : null;
}

const allNodes = db.prepare('SELECT id, type, name, file_path FROM nodes WHERE deprecated = 0').all() as any[];
const allConns = db.prepare('SELECT source_node_id, target_node_id FROM node_connections').all() as any[];
const connectedIds = new Set<string>();
for (const c of allConns) { connectedIds.add(c.source_node_id); connectedIds.add(c.target_node_id); }
const orphans = allNodes.filter(n => !connectedIds.has(n.id));

console.log('Total orphans:', orphans.length);

// Cache repo file lists + content for grepping
const repoFileCache = new Map<string, { path: string; content: string }[]>();
function getRepoFiles(repo: string): { path: string; content: string }[] {
  if (repoFileCache.has(repo)) return repoFileCache.get(repo)!;
  const out: { path: string; content: string }[] = [];
  const IGNORE_DIRS = new Set(['node_modules', 'dist', 'build', '.next', '.git', 'coverage', '.serverless']);
  function walk(dir: string) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      if (IGNORE_DIRS.has(ent.name)) continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|jsx|json)$/.test(ent.name)) {
        try { out.push({ path: p, content: fs.readFileSync(p, 'utf-8') }); } catch { /* ignore */ }
      }
    }
  }
  walk(REPO_PATHS[repo]);
  repoFileCache.set(repo, out);
  return out;
}

function countUsages(repo: string, name: string, declFile: string): { totalHits: number; otherFileHits: number; sameFileExtraHits: number; sampleLocations: string[] } {
  const files = getRepoFiles(repo);
  const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
  let totalHits = 0;
  let otherFileHits = 0;
  let sameFileExtraHits = 0;
  const sampleLocations: string[] = [];
  const declFileNorm = path.resolve(declFile).toLowerCase();
  for (const f of files) {
    const matches = f.content.match(re);
    if (!matches) continue;
    const isDeclFile = path.resolve(f.path).toLowerCase() === declFileNorm;
    const hitsInFile = matches.length;
    totalHits += hitsInFile;
    if (isDeclFile) {
      // subtract 1 for the declaration itself (best-effort)
      if (hitsInFile > 1) {
        sameFileExtraHits += hitsInFile - 1;
        if (sampleLocations.length < 3) sampleLocations.push(`${path.relative(REPO_PATHS[repo], f.path)} (same-file, ${hitsInFile - 1} extra refs)`);
      }
    } else {
      otherFileHits += hitsInFile;
      if (sampleLocations.length < 3) sampleLocations.push(`${path.relative(REPO_PATHS[repo], f.path)} (${hitsInFile} refs)`);
    }
  }
  return { totalHits, otherFileHits, sameFileExtraHits, sampleLocations };
}

const PER_REPO_SAMPLE = 8;
const results: any[] = [];

for (const repo of REPOS) {
  const repoOrphans = orphans.filter(n => repoOf(n.id) === repo);
  const n = Math.min(PER_REPO_SAMPLE, repoOrphans.length);
  const picks: any[] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.floor((i / n) * repoOrphans.length);
    picks.push(repoOrphans[idx]);
  }

  console.log(`\n=== ${repo}: sampling ${picks.length}/${repoOrphans.length} orphans ===`);

  for (const o of picks) {
    const declFile = o.file_path.split(',')[0].trim();
    if (!fs.existsSync(declFile)) {
      console.log(`  [FILE_MISSING] ${o.id}`);
      results.push({ repo, id: o.id, name: o.name, type: o.type, verdict: 'FILE_MISSING' });
      continue;
    }
    const usage = countUsages(repo, o.name, declFile);
    let verdict: string;
    if (usage.otherFileHits > 0) verdict = 'USED_ELSEWHERE_CROSS_FILE';
    else if (usage.sameFileExtraHits > 0) verdict = 'USED_ELSEWHERE_SAME_FILE';
    else verdict = 'TRULY_UNUSED';

    console.log(`  [${verdict}] ${o.name} (${o.type}) — ${o.id}`);
    if (usage.sampleLocations.length) console.log(`      refs: ${usage.sampleLocations.join(' | ')}`);

    results.push({
      repo, id: o.id, name: o.name, type: o.type, declFile,
      otherFileHits: usage.otherFileHits, sameFileExtraHits: usage.sameFileExtraHits,
      sampleLocations: usage.sampleLocations, verdict
    });
  }
}

console.log('\n=== SUMMARY ===');
const summary: any = {};
for (const repo of REPOS) {
  const r = results.filter(x => x.repo === repo);
  const trulyUnused = r.filter(x => x.verdict === 'TRULY_UNUSED').length;
  const usedCross = r.filter(x => x.verdict === 'USED_ELSEWHERE_CROSS_FILE').length;
  const usedSame = r.filter(x => x.verdict === 'USED_ELSEWHERE_SAME_FILE').length;
  const missing = r.filter(x => x.verdict === 'FILE_MISSING').length;
  summary[repo] = { total: r.length, trulyUnused, usedCross, usedSame, missing };
  console.log(`${repo}: total=${r.length} deadCode=${trulyUnused} falseOrphan(cross-file)=${usedCross} falseOrphan(same-file)=${usedSame} fileMissing=${missing}`);
}
const totalR = results.length;
const totalDead = results.filter(x => x.verdict === 'TRULY_UNUSED').length;
const totalFalseCross = results.filter(x => x.verdict === 'USED_ELSEWHERE_CROSS_FILE').length;
const totalFalseSame = results.filter(x => x.verdict === 'USED_ELSEWHERE_SAME_FILE').length;
console.log(`\nAGGREGATE: total=${totalR} deadCode=${totalDead} (${(100*totalDead/totalR).toFixed(1)}%) falseOrphanCrossFile=${totalFalseCross} (${(100*totalFalseCross/totalR).toFixed(1)}%) falseOrphanSameFile=${totalFalseSame} (${(100*totalFalseSame/totalR).toFixed(1)}%)`);

fs.writeFileSync(path.join(__dirname, 'orphans-output.json'), JSON.stringify({ results, summary, totalOrphans: orphans.length }, null, 2));
db.close();
