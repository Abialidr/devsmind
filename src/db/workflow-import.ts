import * as fs from 'fs';
import * as path from 'path';
import { DevMindDatabase } from './database';

export interface WorkflowImportResult {
  created: string[];
  updated: string[];
  skipped: string[];
}

/**
 * Derives a workflow name/description from a flow doc's markdown structure
 * (`# Title`, `## Summary`), falling back to the filename / first paragraph
 * when a file doesn't follow that convention.
 */
export function deriveTitleFromMarkdown(content: string, fileBaseName: string): { name: string; description: string } {
  const titleMatch = content.match(/^#\s+(.+)$/m);
  let name: string;
  if (titleMatch) {
    name = titleMatch[1].replace(/\s*\(.*?\)\s*$/, '').trim();
  } else {
    name = fileBaseName
      .replace(/\.[^.]+$/, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\bflow\b/gi, '')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  const summaryMatch = content.match(/^##\s+Summary\s*\n+([\s\S]*?)(?:\n##\s|\n---|\s*$)/mi);
  let description: string;
  if (summaryMatch) {
    description = summaryMatch[1].trim().split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim();
  } else {
    const afterTitle = titleMatch ? content.slice(content.indexOf(titleMatch[0]) + titleMatch[0].length) : content;
    const para = afterTitle.split(/\n\s*\n/).map(p => p.trim()).find(p => p && !p.startsWith('#'));
    description = para ? para.replace(/\s+/g, ' ').trim() : `Imported from ${fileBaseName}`;
  }

  return { name: name || fileBaseName, description };
}

/** Imports one .md file as a workflow. Shared by the MCP tool and the CLI command. */
export function importOneFlowDoc(db: DevMindDatabase, filePath: string): { name: string; created: boolean } {
  const content = fs.readFileSync(filePath, 'utf-8');
  const fileBaseName = path.basename(filePath);
  const { name, description } = deriveTitleFromMarkdown(content, fileBaseName);
  const { workflow, created } = db.importWorkflowDoc(name, description, content, fileBaseName);
  return { name: workflow.name, created };
}

/** Imports every top-level .md file in `folderPath`, or a single file at `filePath`. Exactly one of the two must be set. */
export function importWorkflowDocs(db: DevMindDatabase, folderPath?: string, filePath?: string): WorkflowImportResult {
  const result: WorkflowImportResult = { created: [], updated: [], skipped: [] };

  const files: string[] = [];
  if (filePath) {
    files.push(filePath);
  } else if (folderPath) {
    if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
      throw new Error(`Not a directory: ${folderPath}`);
    }
    for (const entry of fs.readdirSync(folderPath)) {
      const full = path.join(folderPath, entry);
      if (fs.statSync(full).isFile() && entry.toLowerCase().endsWith('.md')) files.push(full);
    }
  } else {
    throw new Error('Provide either folder_path or file_path.');
  }

  for (const f of files) {
    if (!f.toLowerCase().endsWith('.md') || !fs.existsSync(f)) {
      result.skipped.push(f);
      continue;
    }
    try {
      const { name, created } = importOneFlowDoc(db, f);
      (created ? result.created : result.updated).push(name);
    } catch {
      result.skipped.push(f);
    }
  }

  return result;
}
