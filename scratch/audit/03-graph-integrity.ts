import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

const DEVMIND = 'C:/work/Hanoot/backend/lamda/harrir-docs-information/harrir-brains/.devmind';
const DB_PATH = path.join(DEVMIND, 'brain.db');
const GRAPH_DIR = path.join(DEVMIND, 'graph');

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

function repoOf(nodeId: string): string | null {
  const m = nodeId.match(/^\{([^}]+)\}\//);
  return m ? m[1] : null;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (f.endsWith('.json')) out.push(p);
  }
  return out;
}

const jsonFiles = walk(GRAPH_DIR);
console.log('Total graph/ JSON files:', jsonFiles.length);

interface Malformed { file: string; nodeIndex: number; nodeId?: string; issue: string; }
const malformed: Malformed[] = [];
const dupIdsWithinFile: { file: string; id: string; count: number }[] = [];
const graphNodeIds = new Set<string>();
const graphNodeIdsByRepo = new Map<string, Set<string>>();
for (const r of REPOS) graphNodeIdsByRepo.set(r, new Set());

const allConnRefs: { file: string; source: string; target: string }[] = [];

let filesWithNoRepoTag = 0;

for (const file of jsonFiles) {
  let data: any;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    malformed.push({ file, nodeIndex: -1, issue: `FILE-LEVEL: invalid JSON — ${(e as Error).message}` });
    continue;
  }

  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const seenIdsInFile = new Map<string, number>();

  nodes.forEach((n: any, idx: number) => {
    const issues: string[] = [];
    if (!n || typeof n !== 'object') {
      malformed.push({ file, nodeIndex: idx, issue: 'node is not an object' });
      return;
    }
    if (!n.id || typeof n.id !== 'string' || n.id.trim() === '') issues.push('missing/empty id');
    if (!n.name || typeof n.name !== 'string' || n.name.trim() === '') issues.push('missing/empty name');
    if (!n.type || typeof n.type !== 'string' || n.type.trim() === '') issues.push('missing/empty type');
    if (n.id === 'undefined' || n.name === 'undefined' || n.type === 'undefined') issues.push('literal "undefined" string value');
    if (typeof n.id === 'string' && n.id.includes('undefined')) issues.push(`id contains literal "undefined": ${n.id}`);

    if (issues.length) {
      malformed.push({ file, nodeIndex: idx, nodeId: n.id, issue: issues.join('; ') });
    }

    if (n.id) {
      const c = seenIdsInFile.get(n.id) || 0;
      seenIdsInFile.set(n.id, c + 1);
      graphNodeIds.add(n.id);
      const r = repoOf(n.id);
      if (r && graphNodeIdsByRepo.has(r)) graphNodeIdsByRepo.get(r)!.add(n.id);
      else filesWithNoRepoTag++;
    }
  });

  for (const [id, count] of seenIdsInFile) {
    if (count > 1) dupIdsWithinFile.push({ file, id, count });
  }

  const conns = Array.isArray(data.connections) ? data.connections : [];
  for (const c of conns) {
    if (!c || !c.source_node_id || !c.target_node_id) {
      malformed.push({ file, nodeIndex: -2, issue: `malformed connection entry: ${JSON.stringify(c)}` });
      continue;
    }
    allConnRefs.push({ file, source: c.source_node_id, target: c.target_node_id });
  }
}

console.log('\n=== MALFORMED NODES (all repos) ===');
console.log('Total malformed entries:', malformed.length);
for (const m of malformed.slice(0, 50)) {
  console.log(` - ${path.relative(GRAPH_DIR, m.file)} [idx ${m.nodeIndex}] ${m.nodeId || ''}: ${m.issue}`);
}

console.log('\n=== DUPLICATE IDS WITHIN SAME FILE ===');
console.log('Total:', dupIdsWithinFile.length);
for (const d of dupIdsWithinFile.slice(0, 30)) {
  console.log(` - ${path.relative(GRAPH_DIR, d.file)}: "${d.id}" x${d.count}`);
}

// Dangling connection refs: target or source id not present anywhere in the FULL graph/ corpus
console.log('\n=== DANGLING CONNECTION REFS (graph/ internal) ===');
let danglingCount = 0;
const danglingSamples: any[] = [];
for (const c of allConnRefs) {
  const srcOk = graphNodeIds.has(c.source);
  const tgtOk = graphNodeIds.has(c.target);
  if (!srcOk || !tgtOk) {
    danglingCount++;
    if (danglingSamples.length < 30) danglingSamples.push({ file: path.relative(GRAPH_DIR, c.file), source: c.source, srcOk, target: c.target, tgtOk });
  }
}
console.log('Total dangling connection refs (within graph/ folder):', danglingCount, '/', allConnRefs.length);
for (const d of danglingSamples) console.log(' -', JSON.stringify(d));

// Per-repo tabulation
console.log('\n=== PER REPO TABULATION ===');
const perRepoResult: any = {};
for (const repo of REPOS) {
  const repoMalformed = malformed.filter(m => (m.nodeId && repoOf(m.nodeId) === repo) || m.file.includes(path.sep + repo + path.sep) || m.file.includes('/' + repo + '/'));
  const repoDup = dupIdsWithinFile.filter(d => repoOf(d.id) === repo);
  const repoDangling = allConnRefs.filter(c => repoOf(c.source) === repo || repoOf(c.target) === repo)
    .filter(c => !graphNodeIds.has(c.source) || !graphNodeIds.has(c.target));
  perRepoResult[repo] = {
    malformed: repoMalformed.length,
    dupIds: repoDup.length,
    dangling: repoDangling.length,
    graphNodeCount: graphNodeIdsByRepo.get(repo)!.size
  };
  console.log(`${repo}: malformed=${repoMalformed.length} dupIds=${repoDup.length} dangling=${repoDangling.length} graphNodeCount=${graphNodeIdsByRepo.get(repo)!.size}`);
}

// === DIFF: graph/ node IDs vs brain.db node IDs, per repo ===
console.log('\n=== GRAPH vs DB NODE ID DIFF ===');
const dbNodes = db.prepare('SELECT id, deprecated FROM nodes').all() as any[];
const dbActiveIds = new Set(dbNodes.filter(n => n.deprecated === 0).map(n => n.id));
const dbAllIds = new Set(dbNodes.map(n => n.id));

const diffResult: any = {};
for (const repo of REPOS) {
  const graphIds = graphNodeIdsByRepo.get(repo)!;
  const dbIdsRepo = new Set([...dbActiveIds].filter(id => repoOf(id) === repo));

  const inGraphNotDb = [...graphIds].filter(id => !dbActiveIds.has(id));
  const inDbNotGraph = [...dbIdsRepo].filter(id => !graphIds.has(id));

  diffResult[repo] = {
    graphCount: graphIds.size,
    dbActiveCount: dbIdsRepo.size,
    inGraphNotDb: inGraphNotDb.length,
    inDbNotGraph: inDbNotGraph.length,
    inGraphNotDbSample: inGraphNotDb.slice(0, 5),
    inDbNotGraphSample: inDbNotGraph.slice(0, 5)
  };
  console.log(`\n${repo}: graph=${graphIds.size} db_active=${dbIdsRepo.size} | in graph but NOT db=${inGraphNotDb.length} | in db but NOT graph=${inDbNotGraph.length}`);
  if (inGraphNotDb.length) console.log('  in-graph-not-db sample:', inGraphNotDb.slice(0, 5));
  if (inDbNotGraph.length) console.log('  in-db-not-graph sample:', inDbNotGraph.slice(0, 5));
}

const totalGraphIds = graphNodeIds.size;
const totalDbActive = dbActiveIds.size;
const totalInGraphNotDb = [...graphNodeIds].filter(id => !dbActiveIds.has(id)).length;
const totalInDbNotGraph = [...dbActiveIds].filter(id => !graphNodeIds.has(id)).length;
console.log(`\nAGGREGATE: graph total=${totalGraphIds} db_active total=${totalDbActive} in-graph-not-db=${totalInGraphNotDb} in-db-not-graph=${totalInDbNotGraph}`);

fs.writeFileSync(path.join(__dirname, 'graph-integrity-output.json'), JSON.stringify({
  malformedCount: malformed.length,
  malformed,
  dupIdsWithinFile,
  danglingCount,
  danglingSamples,
  perRepoResult,
  diffResult,
  totalGraphIds, totalDbActive, totalInGraphNotDb, totalInDbNotGraph
}, null, 2));

db.close();
