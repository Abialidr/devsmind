/**
 * Verifies the stage_change / commit_changes batch flow, including forward-reference resolution,
 * missing-node auto-fill, clear-then-resolve stale-edge drop, idempotency, and update_history.
 * A fresh DevMindDatabase over the same .devmind dir simulates a server restart (re-runs
 * syncFromDisk from the JSONs).
 *
 * Run: npx ts-node scratch/verify-staging.ts
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DevMindDatabase } from '../src/db/database';
import { stageEntry, readStaged, clearStaged, commitStagedChanges } from '../src/db/staging';

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) failures++;
}

function makeDevmind(): { devmind: string; root: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devsmind-stage-'));
  const devmind = path.join(dir, '.devmind');
  fs.mkdirSync(path.join(devmind, 'graph'), { recursive: true });
  fs.mkdirSync(path.join(devmind, 'history'), { recursive: true });
  fs.writeFileSync(path.join(devmind, 'config.json'), JSON.stringify({
    project_name: 'v', mode: 'embedded', repos: [{ name: 'repo', relative_path: '.' }]
  }));
  return { devmind, root: dir };
}

function reopen(devmind: string): DevMindDatabase {
  return new DevMindDatabase(path.join(devmind, 'brain.db'));
}

function hasEdge(db: DevMindDatabase, src: string, tgt: string): boolean {
  return db.getConnections(tgt).usedBy.some(n => n.id === src);
}

const R = { what_changed: 'x', why: 'y', goal: 'z' };

// ── Forward reference: stage caller BEFORE callee, commit, edge still resolves ────
(function testForwardRef() {
  const { devmind, root } = makeDevmind();
  const aPath = path.join(root, 'a.ts');
  const bPath = path.join(root, 'b.ts');
  fs.writeFileSync(aPath, `import { targetB } from './b';\nexport function callerA(){ return targetB(); }`);
  fs.writeFileSync(bPath, `export function targetB(){ return 1; }`);

  // Stage caller first (forward reference to a not-yet-staged callee).
  stageEntry(devmind, { node_id: 'callerA', file_path: aPath, code_snapshot: fs.readFileSync(aPath, 'utf-8'), reasoning: R });
  stageEntry(devmind, { node_id: 'targetB', file_path: bPath, code_snapshot: fs.readFileSync(bPath, 'utf-8'), reasoning: R });
  check('forward-ref: 2 entries staged', readStaged(devmind).length === 2);

  let db = reopen(devmind);
  const summary = commitStagedChanges(db, devmind, readStaged(devmind));
  clearStaged(devmind);
  db.close();
  check('forward-ref: buffer cleared after commit', readStaged(devmind).length === 0);
  check('forward-ref: reported >=1 edge added', summary.edges_added >= 1);

  db = reopen(devmind); // restart
  check('forward-ref: node callerA exists', !!db.getNode('{repo}/a.ts#callerA'));
  check('forward-ref: node targetB exists', !!db.getNode('{repo}/b.ts#targetB'));
  check('forward-ref: edge callerA→targetB resolved + survives restart', hasEdge(db, '{repo}/a.ts#callerA', '{repo}/b.ts#targetB'));
  db.close();
})();

// ── Auto-fill: stage only the caller; its callee exists on disk but is unstaged ───
(function testAutoFill() {
  const { devmind, root } = makeDevmind();
  const aPath = path.join(root, 'a.ts');
  const uPath = path.join(root, 'utils.ts');
  fs.writeFileSync(uPath, `export function helper(){ return 2; }`);
  fs.writeFileSync(aPath, `import { helper } from './utils';\nexport function callerA(){ return helper(); }`);

  stageEntry(devmind, { node_id: 'callerA', file_path: aPath, code_snapshot: fs.readFileSync(aPath, 'utf-8'), reasoning: R });
  let db = reopen(devmind);
  const summary = commitStagedChanges(db, devmind, readStaged(devmind));
  clearStaged(devmind);
  db.close();
  check('auto-fill: reported >=1 missing node filled', summary.missing_filled >= 1);

  db = reopen(devmind); // restart
  check('auto-fill: helper node auto-created', !!db.getNode('{repo}/utils.ts#helper'));
  check('auto-fill: edge callerA→helper linked + survives restart', hasEdge(db, '{repo}/a.ts#callerA', '{repo}/utils.ts#helper'));
  db.close();
})();

// ── Clear-then-resolve: re-commit a changed file that dropped a call → stale edge gone ─
(function testStaleDrop() {
  const { devmind, root } = makeDevmind();
  const aPath = path.join(root, 'a.ts');
  const bPath = path.join(root, 'b.ts');
  fs.writeFileSync(bPath, `export function targetB(){ return 1; }`);
  fs.writeFileSync(aPath, `import { targetB } from './b';\nexport function callerA(){ return targetB(); }`);

  let db = reopen(devmind);
  commitStagedChanges(db, devmind, [
    { node_id: 'callerA', file_path: aPath, code_snapshot: fs.readFileSync(aPath, 'utf-8'), reasoning: R },
    { node_id: 'targetB', file_path: bPath, code_snapshot: fs.readFileSync(bPath, 'utf-8'), reasoning: R }
  ]);
  check('stale-drop: edge present after first commit', hasEdge(db, '{repo}/a.ts#callerA', '{repo}/b.ts#targetB'));
  db.close();

  // Edit a.ts on disk so it no longer calls targetB, then re-commit just callerA.
  fs.writeFileSync(aPath, `export function callerA(){ return 42; }`);
  db = reopen(devmind);
  commitStagedChanges(db, devmind, [
    { node_id: 'callerA', file_path: aPath, code_snapshot: fs.readFileSync(aPath, 'utf-8'), reasoning: R }
  ]);
  db.close();

  db = reopen(devmind); // restart
  check('stale-drop: stale edge callerA→targetB removed', !hasEdge(db, '{repo}/a.ts#callerA', '{repo}/b.ts#targetB'));
  check('stale-drop: targetB node still exists (unrelated node untouched)', !!db.getNode('{repo}/b.ts#targetB'));
  db.close();
})();

// ── Idempotency: committing the same batch twice yields same graph, no dup history ─
(function testIdempotency() {
  const { devmind, root } = makeDevmind();
  const aPath = path.join(root, 'a.ts');
  const bPath = path.join(root, 'b.ts');
  fs.writeFileSync(bPath, `export function targetB(){ return 1; }`);
  fs.writeFileSync(aPath, `import { targetB } from './b';\nexport function callerA(){ return targetB(); }`);
  const batch = [
    { node_id: 'callerA', file_path: aPath, code_snapshot: fs.readFileSync(aPath, 'utf-8'), reasoning: R },
    { node_id: 'targetB', file_path: bPath, code_snapshot: fs.readFileSync(bPath, 'utf-8'), reasoning: R }
  ];

  let db = reopen(devmind);
  commitStagedChanges(db, devmind, batch);
  commitStagedChanges(db, devmind, batch); // second time, same session (<1h) → in-place history
  const histCount = db.getFullHistory('{repo}/a.ts#callerA').length;
  const edgeCount = db.getConnections('{repo}/a.ts#callerA').uses.length;
  db.close();
  check('idempotency: no duplicate history for callerA (session boundary)', histCount === 1);
  check('idempotency: exactly one outgoing edge for callerA', edgeCount === 1);
})();

// ── update_history single-call still creates node + history + resolves its edge ────
(function testUpdateHistorySingle() {
  const { devmind, root } = makeDevmind();
  const aPath = path.join(root, 'a.ts');
  const bPath = path.join(root, 'b.ts');
  fs.writeFileSync(bPath, `export function targetB(){ return 1; }`);
  fs.writeFileSync(aPath, `import { targetB } from './b';\nexport function callerA(){ return targetB(); }`);

  let db = reopen(devmind);
  // callee must exist for the single-call edge to resolve (no forward-ref in single mode)
  commitStagedChanges(db, devmind, [{ node_id: 'targetB', file_path: bPath, code_snapshot: fs.readFileSync(bPath, 'utf-8'), reasoning: R }]);
  // now the single-shot update_history equivalent for the caller
  commitStagedChanges(db, devmind, [{ node_id: 'callerA', file_path: aPath, code_snapshot: fs.readFileSync(aPath, 'utf-8'), reasoning: R }]);
  db.close();

  db = reopen(devmind);
  check('update_history: node created + history saved', db.getFullHistory('{repo}/a.ts#callerA').length === 1);
  check('update_history: outgoing edge resolved', hasEdge(db, '{repo}/a.ts#callerA', '{repo}/b.ts#targetB'));
  db.close();
})();

console.log(failures === 0 ? '\n🎉 ALL STAGING CHECKS PASSED' : `\n💥 ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
