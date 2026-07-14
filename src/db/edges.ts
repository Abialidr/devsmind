import * as fs from 'fs';
import * as path from 'path';
import { DevMindDatabase } from './database';
import { resolveConnectionsLocally, extractNodeFromFile, MissingRef } from '../utils/ast';

/** Aggregated missing-node record (deduped by target file + symbol). */
export interface MissingAgg { file: string; symbol: string; referenced_by: Set<string>; }

/** Builds a MissingRef -> MissingAgg collector (dedupes by target file + symbol). */
export function createMissingCollector(): { missing: Map<string, MissingAgg>; onMissing: (rec: MissingRef) => void } {
  const missing = new Map<string, MissingAgg>();
  const onMissing = (rec: MissingRef) => {
    const key = rec.targetFile + ' ' + rec.name;
    let e = missing.get(key);
    if (!e) { e = { file: rec.targetFile, symbol: rec.name, referenced_by: new Set() }; missing.set(key, e); }
    e.referenced_by.add(rec.sourceNodeId);
  };
  return { missing, onMissing };
}

/**
 * Deterministically creates nodes for used-but-unextracted references (Phase-1 gaps) from
 * the AST — no LLM — re-resolves edges for the new nodes and their callers so the edges
 * appear. Returns the number of nodes auto-created. This is inbuilt behaviour of every
 * edge-resolution run.
 *
 * @param opts.writeReport  write `missing_nodes_report.json` (CLI indexer wants this; the MCP
 *                          commit path does not — defaults true).
 * @param opts.quiet        suppress console output (MCP path; defaults false).
 */
export function finalizeMissingNodes(
  resolvedDevmind: string,
  db: DevMindDatabase,
  missing: Map<string, MissingAgg>,
  opts: { writeReport?: boolean; quiet?: boolean } = {}
): number {
  const writeReport = opts.writeReport !== false;
  const quiet = opts.quiet === true;
  const filledIds = new Set<string>();

  if (missing.size > 0) {
    const reresolve = new Set<string>();
    for (const e of missing.values()) {
      const derived = extractNodeFromFile(e.file, e.symbol);
      if (!derived) continue; // can't locate the declaration — leave in report only
      const id = `${db.toRepoRelativePath(e.file)}#${e.symbol}`;
      db.upsertNode({ id, name: derived.name, type: derived.type, file_path: e.file, signature: derived.signature });
      db.updateHistory({
        node_id: id,
        code_snapshot: derived.codeSnapshot,
        reasoning: {
          what_changed: 'Auto-created from a used-but-unextracted reference (--fill-missing)',
          why: 'Fill a Phase-1 extraction gap detected during edge resolution',
          goal: 'Complete the node graph deterministically from the AST',
          developer: 'devsmind fill-missing',
          model: 'ast'
        }
      });
      filledIds.add(id);
      for (const s of e.referenced_by) reresolve.add(s);
    }
    if (filledIds.size > 0) {
      const allNodes = db.listNodes();
      const allIds = new Set(allNodes.map(n => n.id));
      for (const id of new Set<string>([...filledIds, ...reresolve])) {
        const n = db.getNode(id);
        if (!n || !n.file_path) continue;
        for (const t of resolveConnectionsLocally(id, n.file_path, allNodes, resolvedDevmind)) {
          if (allIds.has(t)) db.addConnection(id, t);
        }
      }
    }
  }

  if (writeReport) {
    const report = [...missing.values()].map(e => {
      const id = `${db.toRepoRelativePath(e.file)}#${e.symbol}`;
      return {
        file: db.toRepoRelativePath(e.file),
        symbol: e.symbol,
        count: e.referenced_by.size,
        referenced_by: [...e.referenced_by],
        filled: filledIds.has(id)
      };
    }).sort((a, b) => b.count - a.count);

    try {
      fs.writeFileSync(
        path.join(resolvedDevmind, 'missing_nodes_report.json'),
        JSON.stringify({ total: report.length, filled: filledIds.size, missing: report }, null, 2),
        'utf-8'
      );
    } catch { /* ignore */ }

    if (!quiet) {
      console.log(`\n  🔍 Missing-node references: ${report.length} — auto-created ${filledIds.size}`);
      console.log(`  └─ ${path.join(resolvedDevmind, 'missing_nodes_report.json')}`);
    }
  }

  return filledIds.size;
}

/**
 * Resolves outgoing connections for a batch of source nodes via the local AST resolver, adding
 * each resolved edge additively (INSERT OR IGNORE), then auto-creating any missing target nodes.
 * Shared by the CLI indexer and the MCP commit_changes flow.
 *
 * @param opts.clearSources  delete the source nodes' existing OUTGOING edges before re-resolving
 *   (drops edges the code no longer has) while leaving every other node's edges intact. Off by
 *   default (pure-additive) to match the CLI's per-node loop.
 */
export function resolveEdgesForNodes(
  db: DevMindDatabase,
  devmindPath: string,
  sourceNodeIds: string[],
  opts: { clearSources?: boolean } = {}
): { edgesAdded: number; missingFilled: number } {
  if (sourceNodeIds.length === 0) return { edgesAdded: 0, missingFilled: 0 };

  if (opts.clearSources) {
    db.clearConnectionsForSources(sourceNodeIds);
  }

  const { missing, onMissing } = createMissingCollector();
  const allNodes = db.listNodes();
  const allIds = new Set(allNodes.map(n => n.id));

  let edgesAdded = 0;
  for (const rawId of sourceNodeIds) {
    const n = db.getNode(rawId);
    if (!n || !n.file_path) continue;
    for (const targetId of resolveConnectionsLocally(n.id, n.file_path, allNodes, devmindPath, onMissing)) {
      if (allIds.has(targetId)) {
        db.addConnection(n.id, targetId);
        edgesAdded++;
      }
    }
  }

  const missingFilled = finalizeMissingNodes(devmindPath, db, missing, { writeReport: false, quiet: true });
  return { edgesAdded, missingFilled };
}
