import * as fs from 'fs';
import * as path from 'path';
import prompts from 'prompts';
import { resolveDevmindDir } from '../utils/config';
import { DevMindDatabase } from '../db/database';
import { DbWorkflow } from '../db/schema';
import { importWorkflowDocs } from '../db/workflow-import';

function openDb(pathOpt?: string): { db: DevMindDatabase; devmindDir: string } {
  const devmindDir = resolveDevmindDir(pathOpt);
  if (!devmindDir) {
    console.error(
      `❌ No .devmind directory found.\n` +
      `   Run from inside a DevsMind brain folder, or pass --path <devmind_path>.`
    );
    process.exit(1);
  }
  return { db: new DevMindDatabase(path.join(devmindDir, 'brain.db')), devmindDir };
}

/** `devsmind workflow` — interactive list/view/pause/resume. Day-to-day creation and step-recording happens through the MCP tools the agent calls, not this command. */
export async function handleWorkflow(opts: { path?: string }): Promise<void> {
  const { db } = openDb(opts.path);
  try {
    await runWorkflowLoop(db);
  } finally {
    db.close();
  }
}

async function runWorkflowLoop(db: DevMindDatabase) {
  while (true) {
    const workflows = db.listWorkflows();
    if (workflows.length === 0) {
      console.log('📝 No workflows yet. Create one via the workflow_create MCP tool, or import existing docs with `devsmind workflow import <path>`.');
      return;
    }

    const statusEmoji: Record<string, string> = { active: '🟢', paused: '⏸️', completed: '✅' };
    const choices = workflows.map(w => ({
      title: `${statusEmoji[w.status] || ''} [${w.status}] ${w.name}`,
      value: w.id
    }));
    choices.push({ title: '🚪 Exit', value: 'exit' });

    const response = await prompts({
      type: 'select',
      name: 'id',
      message: `Workflows (${workflows.length}):`,
      choices
    });

    if (!response.id || response.id === 'exit') {
      console.log('🚪 Goodbye!');
      break;
    }

    await showWorkflowMenu(db, response.id);
  }
}

async function showWorkflowMenu(db: DevMindDatabase, id: string) {
  while (true) {
    let workflow: DbWorkflow;
    let steps, artifacts;
    try {
      ({ workflow, steps, artifacts } = db.getWorkflowContext(id));
    } catch {
      return;
    }

    console.log(`\n==================================================`);
    console.log(`📋 ${workflow.name}  [${workflow.status}]`);
    console.log(`==================================================`);
    console.log(workflow.description);
    console.log(`\nSteps (${steps.length}):`);
    for (const s of steps) {
      console.log(`  ${s.step_index}. ${s.summary}${s.pending_tasks ? `  (pending: ${s.pending_tasks})` : ''}`);
    }
    console.log(`\nArtifacts (${artifacts.length}):`);
    for (const a of artifacts) {
      console.log(`  - [${a.type}] ${a.source_name} → ${a.file_path.replace(/\\/g, '/')}`);
    }

    const choices: { title: string; value: string }[] = [];
    if (workflow.status !== 'active') choices.push({ title: '▶️ Resume (make active)', value: 'resume' });
    if (workflow.status === 'active') choices.push({ title: '⏸️ Pause', value: 'pause' });
    if (workflow.status !== 'completed') choices.push({ title: '✅ Mark completed', value: 'complete' });
    choices.push({ title: '⬅️ Back to list', value: 'back' });

    const response = await prompts({ type: 'select', name: 'action', message: 'Action:', choices });

    if (!response.action || response.action === 'back') return;
    if (response.action === 'resume') db.resumeWorkflow(id);
    if (response.action === 'pause') db.pauseWorkflow();
    if (response.action === 'complete') db.completeWorkflow(id);
  }
}

/** `devsmind workflow import <path>` — imports a folder of .md flow docs, or a single file, as paused workflows. */
export async function handleWorkflowImport(pathArg: string, opts: { path?: string }): Promise<void> {
  const { db } = openDb(opts.path);
  try {
    const resolved = path.resolve(pathArg);
    const isDir = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory();
    const result = importWorkflowDocs(db, isDir ? resolved : undefined, isDir ? undefined : resolved);

    console.log(`\n📥 Import complete.`);
    if (result.created.length) console.log(`   Created (${result.created.length}): ${result.created.join(', ')}`);
    if (result.updated.length) console.log(`   Updated (${result.updated.length}): ${result.updated.join(', ')}`);
    if (result.skipped.length) console.log(`   Skipped (${result.skipped.length}): ${result.skipped.join(', ')}`);
    if (!result.created.length && !result.updated.length && !result.skipped.length) {
      console.log('   Nothing to import.');
    }
    console.log();
  } finally {
    db.close();
  }
}
