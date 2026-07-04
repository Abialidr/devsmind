import * as fs from 'fs';
import * as path from 'path';
import { DevMindConfig } from '../utils/config';

function findDevmindDir(startDir: string): string | null {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, '.devmind');
    if (fs.existsSync(path.join(candidate, 'config.json'))) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function handleRule(opts: { path?: string }) {
  const cwd = process.cwd();

  let devmindDir: string | null;
  if (opts.path) {
    const resolved = path.resolve(opts.path);
    devmindDir = fs.existsSync(path.join(resolved, 'config.json')) ? resolved : null;
  } else {
    devmindDir = findDevmindDir(cwd);
  }

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
  }

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

  const bt = '`';

  const lines = [
    '## DevsMind — AI Brain',
    '',
    `**DEVMIND_PATH**: ${bt}${devmindDir}${bt}`,
    `**Project**: ${projectName} | **Mode**: ${mode} | **Tech**: ${techLine} | **Session timeout**: ${timeout}min`,
    `**Repos**: ${repoLines}`,
    notes ? `**Notes**: ${notes}` : '',
    '',
    '### Tool Triggers',
    '',
    '| Situation | Tool |',
    '|-----------|------|',
    `| Searching for a module, feature, or concept | ${bt}search_nodes${bt} |`,
    `| Need to read the code of a specific function/class | ${bt}get_node_code${bt} |`,
    `| Working on / debugging a specific function or class | ${bt}get_node_summary${bt} → ${bt}get_node_history${bt} → ${bt}get_node_graph${bt} |`,
    `| After finishing code edits to a function/class | ${bt}update_history${bt} (once per session, not per message) |`,
    `| Function/class is renamed | ${bt}rename_node${bt} |`,
    `| Function/class is removed from codebase | ${bt}deprecate_node${bt} |`,
    '',
    '### Critical Rules',
    '',
    `1. **Never guess dependencies** — call ${bt}get_node_graph${bt} before touching any function signature.`,
    `2. **Always read history first** — call ${bt}get_node_history${bt} before refactoring to understand past decisions.`,
    `3. **No deletions** — never delete nodes. Use ${bt}deprecate_node${bt} to preserve history.`,
    `4. **Resurrecting nodes** — calling ${bt}update_history${bt} or ${bt}add_node${bt} on a deprecated node automatically re-activates it.`,
    `5. **Search before grep** — use ${bt}search_nodes${bt} before any filesystem search.`,
    `6. **Code snapshots — populate if missing** — always call ${bt}get_node_code${bt} before reading a source file. If no snapshot exists, read the file, then immediately call ${bt}update_history${bt} with the current code. Do not skip this — it caches the code for all future agents.`,
    `7. **Code snapshots — refresh if stale** — if you open a source file and notice the stored snapshot differs from the actual file, call ${bt}update_history${bt} with the fresh code before making any changes. Stale snapshots must be corrected first.`,
    '',
    '### Available Tools',
    [
      'search_nodes', 'get_node_summary', 'get_node_code', 'get_node_graph',
      'get_node_history', 'update_history', 'add_node', 'add_connection',
      'rename_node', 'deprecate_node', 'get_recent_changes', 'get_developer_activity',
      'get_changes_by_requirement', 'search_decisions', 'get_orphaned_nodes',
      'recheck_graph', 'get_visualizer_url'
    ].map(t => `${bt}${t}${bt}`).join(' · '),
    '',
    '> All tool schemas and argument details are exposed automatically by the MCP server.'
  ];

  const rule = lines.filter(l => l !== null).join('\n');

  const divider = '═'.repeat(70);

  console.log(`\n${divider}`);
  console.log(` DevsMind Workspace Rule — "${projectName}"`);
  console.log(` Copy the block below into your AI workspace rules file`);
  console.log(`${divider}\n`);
  console.log(rule);
  console.log(`\n${divider}`);
  console.log(` 💡 Tip: save this to .agents/AGENTS.md in your workspace root`);
  console.log(`    or paste directly into your IDE's AI rules/instructions panel.`);
  console.log(`${divider}\n`);
}
