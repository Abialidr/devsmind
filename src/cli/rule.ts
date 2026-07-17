import * as fs from 'fs';
import * as path from 'path';
import { DevMindConfig, resolveDevmindDir } from '../utils/config';
import {
  pickTarget,
  pickMode,
  pickRuleScope,
  pickDirectory,
  confirmPrompt,
  mergeRuleFile,
  writeConfigFile,
  CancelledError,
} from './integrations/prompt';
import { resolveScopeFile, resolveOsPath } from './integrations/registry';
import { INDEXABLE_EXTENSIONS } from '../utils/scanner';

/**
 * Build the ready-to-paste DevsMind workspace rule from a project's config.
 * Pure string builder — no I/O — so it can be printed or written to a file.
 */
export function buildRule(config: DevMindConfig, devmindDir: string): string {
  const projectName = config.project_name;
  const mode = config.mode;
  const notes = config.notes;
  const tech = config.tech_stack;
  const repos = config.repos;

  const repoLines = repos
    .map(r => ('relative_path' in r ? `${r.name} → ${r.relative_path}` : `${r.name} → env:${r.path_key}`))
    .join(', ');

  const techLine = tech
    ? [...(tech.languages || []), ...(tech.frameworks || [])].join(', ')
    : 'Not specified';

  const timeout = config.session_timeout_minutes ?? 60;
  const safeDevmindDir = devmindDir.replace(/\\/g, '/');

  const bt = '`';

  const lines = [
    '## DevsMind — AI Brain',
    '',
    `**DEVMIND_PATH**: ${bt}${safeDevmindDir}${bt}`,
    `**Project**: ${projectName} | **Mode**: ${mode} | **Tech**: ${techLine} | **Session timeout**: ${timeout}min`,
    `**Repos**: ${repoLines}`,
    notes ? `**Notes**: ${notes}` : '',
    '',
    '### What This Is',
    '',
    `DevsMind is this team's shared code graph — every teammate's AI agent reads the same graph you write to, there is no "your copy." ${bt}get_node_graph${bt} shows what git can't (live callers/callees, before you break a signature). ${bt}get_node_history${bt} shows what git blame can't (why a change was made, not just who/when). Both are worthless if changes stop getting recorded — so recording is not optional, it's the product.`,
    '',
    '### Tool Triggers',
    '',
    '| Situation | Tool |',
    '|-----------|------|',
    `| Searching for a module, feature, concept, or code fragment | ${bt}search_nodes${bt} (name/reasoning match, auto-falls-back to code-content search) — never start with grep |`,
    `| List/discover all nodes for a component or directory | ${bt}list_nodes${bt} |`,
    `| Read the code of ONE function/class | ${bt}get_node_code${bt} (live-parsed, cheaper than opening the file) |`,
    `| Trace a flow through MULTIPLE functions | ${bt}get_node_graph${bt} ${bt}direction:"out"${bt} + ${bt}include_code:true${bt} in ONE call — don't chain ${bt}get_node_code${bt} per function |`,
    `| What would break if I change this? | ${bt}get_node_graph${bt} ${bt}direction:"in"${bt} (every caller) |`,
    `| Before refactoring a function | ${bt}get_node_history${bt} first |`,
    `| The moment you finish editing one node | ${bt}stage_change${bt} for that node — immediately, not batched |`,
    `| Checkpoints during a long task, and before ending any turn with staged work | ${bt}commit_changes${bt} |`,
    `| Function/class renamed | ${bt}rename_node${bt} |`,
    `| Function/class removed | ${bt}deprecate_node${bt} (never delete — history is lost otherwise) |`,
    '',
    '### Recording Changes — Per Node, Not Per File, Not At The End',
    '',
    `${bt}stage_change${bt} is source code only (${Array.from(INDEXABLE_EXTENSIONS).sort().join(', ')}) — skip stylesheets, markup, config, docs, images.`,
    '',
    `1. Call ${bt}stage_change${bt} once per touched **node** the moment you finish it — a file with 3 changed functions is 3 calls, made as you go, not saved up. Pass ${bt}node_id${bt}, ${bt}file_path${bt}, ${bt}code_snapshot${bt}, ${bt}reasoning${bt}. Never hand-guess connections — ${bt}commit_changes${bt} resolves them via AST.`,
    `2. Call ${bt}commit_changes${bt} at natural checkpoints (a batch of related nodes, a context switch) — not saved for a single end-of-task call that's easy to skip when the task runs long. Staging alone writes nothing; always commit before ending a turn with anything staged.`,
    `3. Don't print node/history data as text instead of calling the tools — that looks done but records nothing.`,
    '',
    '### Other Rules',
    '',
    `1. **No external scripts for indexing.** Use ${bt}index_start${bt} / ${bt}index_checkpoint${bt} / ${bt}index_continue${bt} / ${bt}index_complete${bt} natively so progress survives a context reset.`,
    `2. **Don't pause mid-index** for confirmation — keep going until the workspace is indexed or the context limit is hit.`,
    `3. **Drift signals** — ${bt}get_node_code${bt} returning ${bt}snapshot_outdated:true${bt} means re-record via ${bt}stage_change${bt}+${bt}commit_changes${bt}; ${bt}source:"cached"${bt} means the symbol wasn't found (renamed/moved/deleted) — verify, then ${bt}rename_node${bt} or ${bt}deprecate_node${bt}.`,
    `4. **Before multi-day work**, call ${bt}workflow_list${bt} — if a paused workflow matches, offer to resume it (${bt}workflow_resume${bt} + ${bt}workflow_get_context${bt}) instead of starting fresh. While a workflow is active, ${bt}commit_changes${bt} auto-logs a step from what you staged — call ${bt}workflow_add_step${bt} directly only for something a commit doesn't cover (a decision with no code change, or a ${bt}pending_tasks${bt} note).`,
    '',
    '### Available Tools',
    '',
    '| Tool | Use when |',
    '|------|----------|',
    `| ${bt}search_nodes${bt} | Find code by name, keyword, or reasoning text — auto-falls-back to a regex/string code-content search if nothing matches |`,
    `| ${bt}list_nodes${bt} | List nodes in the graph with optional filters (type, file path, etc.) |`,
    `| ${bt}get_node_summary${bt} | Get file location, connection count, history count for a node |`,
    `| ${bt}get_node_code${bt} | Get ONE node's current source, parsed live from its file (use instead of reading the file) |`,
    `| ${bt}get_node_graph${bt} | See a node's callers/dependencies. With ${bt}direction:"out"${bt} + ${bt}include_code:true${bt}, returns an entire call flow WITH source code in a single call |`,
    `| ${bt}get_node_history${bt} | Read all past snapshots and reasoning logs for a node |`,
    `| ${bt}stage_change${bt} | Buffer one touched node after a code change (code + reasoning only; no edge reasoning) |`,
    `| ${bt}commit_changes${bt} | Flush all staged changes: create nodes, save history, resolve all connections via AST |`,
    `| ${bt}rename_node${bt} | Rename a node ID and update all its connections/history |`,
    `| ${bt}deprecate_node${bt} | Mark a removed function/class as deprecated (preserves history) |`,
    `| ${bt}get_recent_changes${bt} | List nodes modified in the last N hours across the project |`,
    `| ${bt}get_developer_activity${bt} | List recent changes made by a specific developer |`,
    `| ${bt}get_changes_by_requirement${bt} | Find all changes linked to a ticket or requirement ID |`,
    `| ${bt}search_decisions${bt} | Search architectural reasoning and decision logs by keyword |`,
    `| ${bt}get_orphaned_nodes${bt} | Find nodes with no connections (dead code / stale entries) |`,
    `| ${bt}recheck_graph${bt} | Scan files, deprecate nodes for deleted files, clean primitives |`,
    `| ${bt}analyze_graph${bt} | Local, zero-token graph health check — god entities, cycles, orphans, dangling edges, renames, and more. ${bt}fix:true${bt} applies safe automatic fixes |`,
    `| ${bt}get_visualizer_url${bt} | Get URL to open the interactive 2D/3D graph visualizer |`,
    `| ${bt}workflow_list${bt} | List persistent feature workflows — check before starting work that might relate to a paused one |`,
    `| ${bt}workflow_create${bt} | Start a new cross-session workflow for a multi-day feature |`,
    `| ${bt}workflow_add_step${bt} | Record progress in the active (or a given) workflow's timeline |`,
    `| ${bt}workflow_pause${bt} / ${bt}workflow_resume${bt} | Pause the active workflow, or resume a paused one |`,
    `| ${bt}workflow_get_context${bt} | Get a workflow's full timeline + artifacts in one call — call right after resuming |`,
    `| ${bt}workflow_add_artifact${bt} | Save reference material (spec, ticket, doc excerpt) into a workflow |`,
    `| ${bt}workflow_sync_retroactive${bt} | Backfill a workflow's timeline after a session that skipped ${bt}workflow_add_step${bt} |`,
    `| ${bt}workflow_import${bt} | Import existing flow/architecture docs as paused, resumable workflows |`,
    '',
    '> All tool argument schemas are exposed automatically by the MCP server.'
  ];

  return lines.filter(l => l !== null).join('\n');
}

function printRuleBanner(rule: string, projectName: string, tip?: string): void {
  const divider = '═'.repeat(70);
  console.log(`\n${divider}`);
  console.log(` DevsMind Workspace Rule — "${projectName}"`);
  console.log(` Copy the block below into your AI workspace rules file`);
  console.log(`${divider}\n`);
  console.log(rule);
  console.log(`\n${divider}`);
  if (tip) {
    console.log(tip);
  } else {
    console.log(` 💡 Tip: save this to .agents/AGENTS.md in your workspace root`);
    console.log(`    or paste directly into your IDE's AI rules/instructions panel.`);
  }
  console.log(`${divider}\n`);
}

/**
 * `devsmind rule` — print the workspace rule and, interactively, help place it
 * in the chosen tool's native rules file (manual snippet or automatic write).
 * Falls back to plain printing when piped/non-TTY or when `--print` is passed,
 * preserving `devsmind rule > file` usage.
 */
export async function handleRule(opts: { path?: string; print?: boolean }): Promise<void> {
  const devmindDir = resolveDevmindDir(opts.path);

  if (!devmindDir) {
    console.error(
      `❌ No .devmind directory found.\n` +
      `   Run from inside a DevsMind brain folder, or pass --path <devmind_path>.`
    );
    process.exit(1);
  }

  const configPath = path.join(devmindDir, 'config.json');
  let config: DevMindConfig;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as DevMindConfig;
  } catch {
    console.error(`❌ Failed to read config.json at ${configPath}`);
    process.exit(1);
    return;
  }

  const rule = buildRule(config, devmindDir);
  const projectName = config.project_name;

  // Backward-compat: piped/redirected output or explicit --print → plain print.
  if (opts.print || !process.stdout.isTTY) {
    printRuleBanner(rule, projectName);
    return;
  }

  const workspaceRoot = path.dirname(devmindDir);

  try {
    const target = await pickTarget();
    const mode = await pickMode();

    if (mode === 'manual') {
      const scope = target.rules.scopes[0];
      const file = resolveScopeFile(scope.file, scope.scope, workspaceRoot);
      const noteFrontmatter = target.rules.wrap
        ? '\n    (this file needs frontmatter — automatic mode adds it for you)'
        : '';
      printRuleBanner(
        rule,
        projectName,
        ` 💡 Save this to ${file.replace(/\\/g, '/')}${noteFrontmatter}`
      );
      return;
    }

    // Automatic mode.
    const scope = await pickRuleScope(target);
    let filePath: string;
    if (scope.scope === 'project') {
      const base = await pickDirectory(workspaceRoot, `Where is the project root for ${target.label}?`);
      filePath = path.join(base, resolveOsPath(scope.file));
    } else {
      filePath = resolveScopeFile(scope.file, 'global', workspaceRoot);
    }

    const merged = mergeRuleFile(filePath, rule, target.rules.style, target.rules.wrap);
    if (merged.error) {
      console.error(`\n❌ ${merged.error}`);
      return;
    }

    console.log(`\n📝 Target: ${filePath.replace(/\\/g, '/')}  (${merged.existed ? (target.rules.style === 'append-section' ? 'merge DevsMind block into existing' : 'overwrite dedicated file') : 'create new'})`);
    console.log(`\n${target.rules.style === 'append-section' ? 'The DevsMind block to be written:' : 'File contents to be written:'}\n`);
    console.log(merged.preview.split('\n').map(l => '   ' + l).join('\n'));

    const ok = await confirmPrompt('Write this?', true);
    if (!ok) {
      console.log('\nAborted — nothing written.');
      return;
    }

    writeConfigFile(filePath, merged.content);
    console.log(`\n✅ DevsMind rule written to ${filePath.replace(/\\/g, '/')} for ${target.label}.`);
  } catch (err) {
    if (err instanceof CancelledError) {
      console.log('\nCancelled.');
      return;
    }
    throw err;
  }
}
