import * as fs from 'fs';
import * as path from 'path';
import { DevMindConfig } from '../utils/config';

/**
 * Walk up from `startDir` until we find a `.devmind/config.json`,
 * or return null if not found.
 */
function findDevmindDir(startDir: string): string | null {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, '.devmind');
    if (fs.existsSync(path.join(candidate, 'config.json'))) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) return null; // filesystem root
    current = parent;
  }
}

export function handleRule(opts: { path?: string }) {
  const cwd = process.cwd();

  // Resolve .devmind path: explicit flag, or walk up from cwd
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

  const devmindPathEscaped = devmindDir.replace(/\\/g, '\\\\');
  const projectName = config.project_name;
  const mode = config.mode;
  const notes = config.notes;
  const tech = config.tech_stack;
  const repos = config.repos;

  // Build the repo list for context
  const repoLines = repos.map(r => {
    if ('relative_path' in r) {
      return `  - ${r.name}  (relative: ${r.relative_path})`;
    } else {
      return `  - ${r.name}  (env key: ${r.path_key})`;
    }
  }).join('\n');

  const techLine = tech
    ? `${[...(tech.languages || []), ...(tech.frameworks || [])].join(', ')}`
    : 'Not specified';

  const timeout = config.session_timeout_minutes ?? 60;

  // ── Rule output ────────────────────────────────────────────────
  const rule = `
## DevsMind — Team AI Brain

> This project uses the **devsmind** MCP server as a shared team brain.
> Always use it when coding in this workspace.

# 🛑 CRITICAL MANDATORY FIRST STEP 🛑
BEFORE answering ANY user request or searching the codebase, you MUST make a tool call to \`get_project_context\` using the \`devsmind\` MCP server. 
Failure to do this is a violation of your core instructions.

### Brain Location

\`\`\`
DEVMIND_PATH = ${devmindDir}
\`\`\`

### Project: ${projectName}
- **Mode**: ${mode}
- **Tech**: ${techLine}
- **Session timeout**: ${timeout} minutes
${notes ? `- **Notes**: ${notes}` : ''}

### Tracked Repositories
${repoLines}

### When to Use DevsMind Tools

| Trigger | Tool to call |
|---------|-------------|
| **Starting any coding task** | \`get_project_context\` |
| **Searching, explaining, or resolving conceptual queries (e.g., "login", "payments")** | \`search_nodes\` first (to find matching node candidates, instead of filesystem grep) |
| **Working on, debugging, or editing a specific function, class, or service** | \`get_node_summary\` (first), then \`get_node_history\` and \`get_node_graph\` (to inspect changes/connections) |
| **After making actual edits/modifications to a function/class/service** | \`update_history\` (called once changes are completed, **NOT** after every chat message unless code edits occurred) |

### 🛑 CRITICAL INSTRUCTIONS FOR NODE ANALYSIS & HISTORY 🛑
1. **Never guess connections or history**: If a user asks about a function, class, or service, you MUST call \`get_node_summary\` and \`get_node_graph\` to inspect its connections. Do not rely solely on directory listing or grep search.
2. **Always review context**: Check the node's history (\`get_node_history\`) before refactoring or fixing bugs to see why previous changes were made.
3. **When to run \`update_history\`**: Run \`update_history\` ONLY after code files/functions/classes have been modified. You do not need to call it after every message if no code edits occurred.
4. **Search nodes first for conceptual questions**: If the user asks a conceptual question (e.g., "login", "payments") and you don't know the exact symbol names yet, you MUST use \`search_nodes\` first to find candidates rather than using raw filesystem grep/list_dir. Inspect candidates with \`get_node_summary\` and \`get_node_graph\` before viewing their source code.
5. **Actively maintain the graph precision & handle renames**: You MUST keep the node graph accurate. 
   - If you discover a missing node or outdated connection while coding, immediately add it using \`add_node\` and \`add_connection\`.
   - **Rename Protocol**: If you find a new node at a file location where a different node used to be (e.g. during refactoring or renaming a function), do NOT just delete and re-add. First check if it is a rename of the existing node (e.g. same logic/file/location but different name). If it is a rename, use \`rename_node\` to update the ID and name (preserving its change history and connections). If it is NOT a rename (i.e. the old function was deleted and a completely new unrelated function was written in its place), delete the old node using \`delete_node\` and add the new one with \`add_node\`.
   - If a node is completely removed from the codebase, immediately delete it using \`delete_node\`. Do not leave orphaned or stale nodes.

### Tool Reference

**\`get_project_context\`**
\`\`\`
devmind_path: "${devmindDir}"
\`\`\`
Returns project config, repos, tech stack, team notes, and developer context.

**\`search_nodes\`**
\`\`\`
devmind_path: "${devmindDir}"
query: "<search query>"
\`\`\`
Searches node names, identifiers, or reasoning logs matching the query.

**\`get_node_summary\`**
\`\`\`
devmind_path: "${devmindDir}"
node_id: "<function or class name>"
\`\`\`
Returns file location, history count, connections, and last change timestamp.

**\`get_node_history\`**
\`\`\`
devmind_path: "${devmindDir}"
node_id: "<function or class name>"
\`\`\`
Returns the full version history of a code node, including all past code snapshots and change reasoning.

**\`get_node_graph\`**
\`\`\`
devmind_path: "${devmindDir}"
node_id: "<starting function or class name>"
max_depth: 6
\`\`\`
Returns a localized node dependency graph up to a specified depth (default 6), showing connected nodes and relationships.

**\`delete_node\`**
\`\`\`
devmind_path: "${devmindDir}"
node_id: "<node ID to delete>"
\`\`\`
Delete a code node and all its incoming/outgoing connections from the graph. Use this if a function/class is deleted, or if an improper/incorrect node was accidentally created.

**\`rename_node\`**
\`\`\`
devmind_path: "${devmindDir}"
old_node_id: "<current unique node ID>"
new_node_id: "<new unique node ID>"
new_name: "<optional new display name>"
\`\`\`
Rename a code node ID, automatically updating all its associations (incoming/outgoing connections and history logs) to prevent losing context.

**\`get_recent_changes\`**
\`\`\`
devmind_path: "${devmindDir}"
hours: 24
\`\`\`
Get team modifications and history updates over the last N hours.

**\`get_developer_activity\`**
\`\`\`
devmind_path: "${devmindDir}"
developer: "<developer name or email>"
limit: 50
\`\`\`
List recent history logs and changes made by a specific developer.

**\`get_changes_by_requirement\`**
\`\`\`
devmind_path: "${devmindDir}"
requirement_id: "<ticket or requirement ID>"
\`\`\`
List all modifications linked to a specific requirement, ticket, or issue ID.

**\`search_decisions\`**
\`\`\`
devmind_path: "${devmindDir}"
query: "<decision keyword>"
\`\`\`
Search reasoning logs for specific architectural or implementation decisions.

**\`get_orphaned_nodes\`**
\`\`\`
devmind_path: "${devmindDir}"
\`\`\`
Find disconnected code nodes in the graph that have no incoming or outgoing connections.

**\`get_visualizer_url\`**
\`\`\`
devmind_path: "${devmindDir}"
\`\`\`
Get local URLs to open the interactive 2D and 3D code graph visualizer pages.

**\`update_history\`**
\`\`\`
devmind_path: "${devmindDir}"
node_id: "<identifier>"
file_path: "<relative path to file>"
code_snapshot: "<full function/class source>"
reasoning:
  what_changed: "<what you changed>"
  why: "<reason>"
  goal: "<what this achieves>"
\`\`\`
Records a code change. Apply the 1-hour session boundary rule automatically.

---
> Generated by: devsmind rule
> Brain: ${devmindDir}
`.trim();

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
