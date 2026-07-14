import * as fs from 'fs';
import * as path from 'path';
import { DevMindDatabase, ReasoningObject } from './database';
import { resolveEdgesForNodes } from './edges';

const STAGING_FILE = 'history_scratchpad.json';

/** One staged change — the same payload as update_history, buffered for a later commit. */
export interface StagedEntry {
  node_id: string;
  file_path: string;
  code_snapshot: string;
  reasoning: string | ReasoningObject;
  name?: string;
  type?: string;
  signature?: string;
  session_id?: string;
  /** Optional explicit edges to add on top of AST resolution (source defaults to this entry). */
  connections?: { source_node_id?: string; target_node_id: string }[];
}

interface StagingBuffer {
  entries: StagedEntry[];
  updated_at: string;
}

function stagingPath(devmindPath: string): string {
  return path.join(path.resolve(devmindPath), STAGING_FILE);
}

/** Atomic write (temp file + rename) so an accumulating buffer is never left half-written. */
function writeBuffer(devmindPath: string, buf: StagingBuffer): void {
  const target = stagingPath(devmindPath);
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(buf, null, 2), 'utf-8');
  fs.renameSync(tmp, target);
}

export function readStaged(devmindPath: string): StagedEntry[] {
  try {
    const raw = fs.readFileSync(stagingPath(devmindPath), 'utf-8');
    const buf = JSON.parse(raw) as StagingBuffer;
    return Array.isArray(buf.entries) ? buf.entries : [];
  } catch {
    return [];
  }
}

/** Appends one entry to the buffer and returns the new pending count. */
export function stageEntry(devmindPath: string, entry: StagedEntry): number {
  const entries = readStaged(devmindPath);
  entries.push(entry);
  writeBuffer(devmindPath, { entries, updated_at: new Date().toISOString() });
  return entries.length;
}

export function clearStaged(devmindPath: string): void {
  const target = stagingPath(devmindPath);
  try {
    if (fs.existsSync(target)) fs.unlinkSync(target);
  } catch { /* ignore */ }
}

/** Resolves an entry's raw node_id to the canonical `{repo}/relpath#symbol` form. */
function resolveEntryId(db: DevMindDatabase, entry: StagedEntry): string {
  if (entry.node_id.includes('#')) return entry.node_id;
  const repoRelPath = db.toRepoRelativePath(entry.file_path);
  return `${repoRelPath}#${entry.node_id}`;
}

export interface CommitSummary {
  nodes: number;
  history_entries: number;
  edges_added: number;
  missing_filled: number;
}

/**
 * Two-pass commit of a batch of staged changes:
 *   Pass 1 — upsert every node + write its history entry (so all nodes exist before any edge
 *            resolution; forward references within the batch resolve regardless of order).
 *   Pass 2 — clear-then-resolve each staged node's OUTGOING edges via the local AST resolver,
 *            auto-creating any missing target nodes. Only the staged nodes' own outbound edges
 *            are recomputed; every other node's edges are left intact.
 *
 * Idempotent: re-running the same batch yields the same graph (upsert + INSERT OR IGNORE +
 * clear-then-resolve). Callers should clear the buffer only after this returns successfully.
 */
export function commitStagedChanges(
  db: DevMindDatabase,
  devmindPath: string,
  entries: StagedEntry[]
): CommitSummary {
  const stagedIds: string[] = [];

  // Pass 1 — nodes + history (+ any explicit connections the caller supplied).
  const explicitEdges: { source: string; target: string }[] = [];
  for (const entry of entries) {
    const nodeId = resolveEntryId(db, entry);
    stagedIds.push(nodeId);

    const name = entry.name || (entry.node_id.includes('.') ? entry.node_id.split('.').pop()! : entry.node_id);
    const type = entry.type || (entry.node_id.includes('.') ? 'method' : 'function');

    db.upsertNode({
      id: nodeId,
      name,
      type,
      file_path: entry.file_path,
      signature: entry.signature || null
    });
    db.updateHistory({
      node_id: nodeId,
      code_snapshot: entry.code_snapshot,
      reasoning: entry.reasoning,
      session_id: entry.session_id
    });

    for (const c of entry.connections || []) {
      if (c.target_node_id) explicitEdges.push({ source: c.source_node_id || nodeId, target: c.target_node_id });
    }
  }

  // Pass 2 — AST edge resolution for the batch (clear stale outbound edges of staged nodes first).
  const { edgesAdded, missingFilled } = resolveEdgesForNodes(db, devmindPath, stagedIds, { clearSources: true });

  // Apply any explicit edges the caller passed, on top of AST resolution (additive).
  for (const e of explicitEdges) {
    db.addConnection(e.source, e.target);
  }

  return {
    nodes: entries.length,
    history_entries: entries.length,
    edges_added: edgesAdded + explicitEdges.length,
    missing_filled: missingFilled
  };
}
