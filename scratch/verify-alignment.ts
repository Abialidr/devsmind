/**
 * Verifies the DB<->disk alignment fixes by simulating a server restart (a fresh
 * DevMindDatabase over the same .devmind dir re-runs syncFromDisk from the JSONs).
 *
 * Run: npx ts-node scratch/verify-alignment.ts
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DevMindDatabase } from '../src/db/database';

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) failures++;
}

function makeDevmind(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devsmind-verify-'));
  const devmind = path.join(dir, '.devmind');
  fs.mkdirSync(path.join(devmind, 'graph'), { recursive: true });
  fs.mkdirSync(path.join(devmind, 'history'), { recursive: true });
  // Embedded repo rooted at the project dir (parent of .devmind) so source files map to
  // "{repo}/relpath" and their graph JSONs land inside graph/ (realistic embedded layout).
  fs.writeFileSync(path.join(devmind, 'config.json'), JSON.stringify({
    project_name: 'v', mode: 'embedded', repos: [{ name: 'repo', relative_path: '.' }]
  }));
  return devmind;
}

function reopen(devmind: string): DevMindDatabase {
  return new DevMindDatabase(path.join(devmind, 'brain.db'));
}

// Two real files inside the workspace so recheck_graph doesn't treat them as missing.
function seed(devmind: string) {
  const root = path.dirname(devmind);
  const aPath = path.join(root, 'a.ts');
  const bPath = path.join(root, 'b.ts');
  fs.writeFileSync(aPath, 'export function callerA(){ return targetB(); }');
  fs.writeFileSync(bPath, 'export function targetB(){ return 1; }');
  const db = reopen(devmind);
  db.upsertNode({ id: 'a.ts#callerA', name: 'callerA', type: 'function', file_path: aPath });
  db.upsertNode({ id: 'b.ts#targetB', name: 'targetB', type: 'function', file_path: bPath });
  db.updateHistory({ node_id: 'b.ts#targetB', code_snapshot: 'export function targetB(){ return 1; }', reasoning: { what_changed: 'x', why: 'y', goal: 'z' } });
  db.addConnection('a.ts#callerA', 'b.ts#targetB'); // inbound edge into targetB lives in a.ts graph JSON
  db.close();
  return { root, aPath, bPath };
}

function hasEdge(db: DevMindDatabase, src: string, tgt: string): boolean {
  return db.getConnections(tgt).usedBy.some(n => n.id === src);
}

// ── Gap 2A + 3: deprecate_node durable + inbound edge gone after restart ──────────
(function testDeprecate() {
  const dm = makeDevmind();
  seed(dm);
  let db = reopen(dm);
  db.deprecateNode('b.ts#targetB');
  db.close();

  db = reopen(dm); // simulate restart
  const node = db.getNode('b.ts#targetB');
  check('deprecate: node still exists after restart', !!node);
  check('deprecate: node stays deprecated=1 after restart', node?.deprecated === 1);
  check('deprecate: inbound edge does NOT resurrect', !hasEdge(db, 'a.ts#callerA', 'b.ts#targetB'));
  db.close();
})();

// ── recheck_graph (prune spurious): missing-file node stays pruned after restart ──
(function testRecheck() {
  const dm = makeDevmind();
  const { root, bPath } = seed(dm);
  fs.rmSync(bPath); // make targetB's file missing -> prune candidate
  let db = reopen(dm);
  const res = db.pruneSpuriousNodes(root);
  check('recheck: pruned at least one node', res.prunedCount >= 1);
  db.close();

  db = reopen(dm); // restart
  const node = db.getNode('b.ts#targetB');
  check('recheck: pruned node not active after restart', !node || node.deprecated === 1);
  check('recheck: inbound edge does NOT resurrect', !hasEdge(db, 'a.ts#callerA', 'b.ts#targetB'));
  db.close();
})();

// ── deleteNode (CLI prune): hard delete does not resurrect from history JSON ───────
(function testDelete() {
  const dm = makeDevmind();
  seed(dm);
  let db = reopen(dm);
  db.deleteNode('b.ts#targetB');
  db.close();

  db = reopen(dm); // restart
  check('delete: node gone after restart (no history resurrection)', !db.getNode('b.ts#targetB'));
  check('delete: inbound edge does NOT resurrect', !hasEdge(db, 'a.ts#callerA', 'b.ts#targetB'));
  db.close();
})();

// ── Gap 1: add_connection refuses a DB-only orphan when source node is absent ──────
(function testAddConnOrphanRefused() {
  const dm = makeDevmind();
  seed(dm);
  let db = reopen(dm);
  // Source node c.ts#callerC does NOT exist -> edge must be refused (not a DB-only orphan).
  db.addConnection('c.ts#callerC', 'b.ts#targetB');
  db.close();
  db = reopen(dm); // restart
  check('add_connection: orphan edge (absent source) is refused', !hasEdge(db, 'c.ts#callerC', 'b.ts#targetB'));
  db.close();
})();

// ── Gap 1: add_connection persists to disk and survives restart when source exists ─
(function testAddConnPersists() {
  const dm = makeDevmind();
  const { root } = seed(dm);
  const cPath = path.join(root, 'c.ts');
  fs.writeFileSync(cPath, 'export function callerC(){ return targetB(); }');
  let db = reopen(dm);
  db.upsertNode({ id: 'c.ts#callerC', name: 'callerC', type: 'function', file_path: cPath });
  db.addConnection('c.ts#callerC', 'b.ts#targetB');
  db.close();
  const graphC = path.join(dm, 'graph', 'repo', 'c.json');
  check('add_connection: source file graph JSON written', fs.existsSync(graphC));
  db = reopen(dm); // restart
  check('add_connection: edge survives restart', hasEdge(db, 'c.ts#callerC', 'b.ts#targetB'));
  db.close();
})();

// ── Regression: rename_node still repoints inbound edges across a restart ──────────
(function testRename() {
  const dm = makeDevmind();
  seed(dm);
  let db = reopen(dm);
  db.renameNode('b.ts#targetB', 'b.ts#renamedB');
  db.close();
  db = reopen(dm); // restart
  check('rename: new id exists after restart', !!db.getNode('b.ts#renamedB'));
  check('rename: old id gone after restart', !db.getNode('b.ts#targetB'));
  check('rename: inbound edge repointed to new id', hasEdge(db, 'a.ts#callerA', 'b.ts#renamedB'));
  db.close();
})();

console.log(failures === 0 ? '\n🎉 ALL CHECKS PASSED' : `\n💥 ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
