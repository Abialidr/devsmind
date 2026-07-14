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

const FRONTEND = new Set(['harrir-mini-app', 'harrir-web', 'harrir-web-admin']);

function repoOf(nodeId: string): string | null {
  const m = nodeId.match(/^\{([^}]+)\}\//);
  return m ? m[1] : null;
}

const allNodes = db.prepare('SELECT id, type, name, file_path, deprecated FROM nodes').all() as any[];
const activeNodes = allNodes.filter(n => n.deprecated === 0);
const allConns = db.prepare('SELECT source_node_id, target_node_id FROM node_connections').all() as any[];

// Build node id sets
const activeIdSet = new Set(activeNodes.map(n => n.id));
const allIdSet = new Set(allNodes.map(n => n.id));

// Orphans: active nodes with no connection (source or target) among ALL connections
const connectedIds = new Set<string>();
for (const c of allConns) {
  connectedIds.add(c.source_node_id);
  connectedIds.add(c.target_node_id);
}
const orphans = activeNodes.filter(n => !connectedIds.has(n.id));

// Dangling connections: source or target not present in nodes table at all (any status)
const danglingConns = allConns.filter(c => !allIdSet.has(c.source_node_id) || !allIdSet.has(c.target_node_id));
// Connections referencing deprecated nodes (still present but shouldn't be "active" graph edges)
const deprecatedIdSet = new Set(allNodes.filter(n => n.deprecated !== 0).map(n => n.id));
const connsToDeprecated = allConns.filter(c => deprecatedIdSet.has(c.source_node_id) || deprecatedIdSet.has(c.target_node_id));

type RepoStat = {
  repo: string;
  totalNodesAll: number;
  activeNodes: number;
  deprecatedNodes: number;
  edgesOut: number; // edges whose source is in this repo
  edgesIn: number; // edges whose target is in this repo (cross+intra)
  edgesIntraRepo: number;
  orphanCount: number;
  orphanRate: number;
  edgeDensity: number; // edges (as source) per active node
  typeCounts: Record<string, number>;
};

const stats: RepoStat[] = [];

for (const repo of REPOS) {
  const repoActiveNodes = activeNodes.filter(n => repoOf(n.id) === repo);
  const repoAllNodes = allNodes.filter(n => repoOf(n.id) === repo);
  const repoActiveIds = new Set(repoActiveNodes.map(n => n.id));

  const edgesOut = allConns.filter(c => repoOf(c.source_node_id) === repo).length;
  const edgesIn = allConns.filter(c => repoOf(c.target_node_id) === repo).length;
  const edgesIntraRepo = allConns.filter(c => repoOf(c.source_node_id) === repo && repoOf(c.target_node_id) === repo).length;

  const repoOrphans = orphans.filter(n => repoOf(n.id) === repo);

  const typeCounts: Record<string, number> = {};
  for (const n of repoActiveNodes) {
    typeCounts[n.type] = (typeCounts[n.type] || 0) + 1;
  }

  stats.push({
    repo,
    totalNodesAll: repoAllNodes.length,
    activeNodes: repoActiveNodes.length,
    deprecatedNodes: repoAllNodes.length - repoActiveNodes.length,
    edgesOut,
    edgesIn,
    edgesIntraRepo,
    orphanCount: repoOrphans.length,
    orphanRate: repoActiveNodes.length > 0 ? repoOrphans.length / repoActiveNodes.length : 0,
    edgeDensity: repoActiveNodes.length > 0 ? edgesOut / repoActiveNodes.length : 0,
    typeCounts
  });
}

// Nodes whose repo doesn't match any of our 8 (sanity check / unparsable ids)
const unmatchedNodes = activeNodes.filter(n => !REPOS.includes(repoOf(n.id) || ''));

console.log('=== AGGREGATE ===');
console.log('Total nodes (all, incl deprecated):', allNodes.length);
console.log('Total active nodes:', activeNodes.length);
console.log('Total deprecated nodes:', allNodes.length - activeNodes.length);
console.log('Total connections (all):', allConns.length);
console.log('Total orphaned active nodes:', orphans.length, `(${(100*orphans.length/activeNodes.length).toFixed(2)}%)`);
console.log('Dangling connections (source/target id not in nodes table at all):', danglingConns.length);
console.log('Connections touching a DEPRECATED node:', connsToDeprecated.length);
console.log('Unmatched-repo active nodes (id doesnt start with known {repo}/):', unmatchedNodes.length);
if (unmatchedNodes.length) console.log(unmatchedNodes.slice(0,10).map(n=>n.id));

console.log('\n=== PER REPO ===');
for (const s of stats) {
  console.log(`\n--- ${s.repo} (${FRONTEND.has(s.repo) ? 'FRONTEND' : 'BACKEND'}) ---`);
  console.log(`  active nodes: ${s.activeNodes}  (deprecated: ${s.deprecatedNodes})`);
  console.log(`  edges out (as source): ${s.edgesOut}  | edges in (as target): ${s.edgesIn} | intra-repo: ${s.edgesIntraRepo}`);
  console.log(`  edge density (out-edges / active node): ${s.edgeDensity.toFixed(3)}`);
  console.log(`  orphans: ${s.orphanCount} (${(s.orphanRate*100).toFixed(2)}%)`);
  console.log(`  type distribution:`, JSON.stringify(s.typeCounts));
}

// Backend vs frontend rollup
function rollup(reposSubset: string[]) {
  const nodes = activeNodes.filter(n => reposSubset.includes(repoOf(n.id) || ''));
  const edges = allConns.filter(c => reposSubset.includes(repoOf(c.source_node_id) || ''));
  const orph = orphans.filter(n => reposSubset.includes(repoOf(n.id) || ''));
  return {
    nodes: nodes.length,
    edges: edges.length,
    orphans: orph.length,
    orphanRate: nodes.length ? orph.length / nodes.length : 0,
    density: nodes.length ? edges.length / nodes.length : 0
  };
}
const backendRepos = REPOS.filter(r => !FRONTEND.has(r));
const frontendRepos = REPOS.filter(r => FRONTEND.has(r));
console.log('\n=== BACKEND vs FRONTEND ===');
console.log('BACKEND (' + backendRepos.join(', ') + '):', JSON.stringify(rollup(backendRepos)));
console.log('FRONTEND (' + frontendRepos.join(', ') + '):', JSON.stringify(rollup(frontendRepos)));

// Write full JSON for later use by other scripts
fs.writeFileSync(path.join(__dirname, 'overview-output.json'), JSON.stringify({
  stats, orphanIds: orphans.map(n=>n.id), danglingConnsCount: danglingConns.length,
  danglingConnsSample: danglingConns.slice(0, 50),
  connsToDeprecatedSample: connsToDeprecated.slice(0, 50)
}, null, 2));

db.close();
