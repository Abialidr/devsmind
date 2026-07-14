import * as fs from 'fs';
import * as path from 'path';
import { scanRepoFiles } from '../src/utils/scanner';

const DEVMIND_PATH = 'C:\\work\\Hanoot\\backend\\lamda\\harrir-docs-information\\harrir-brains\\.devmind';
const GRAPH_DIR = path.join(DEVMIND_PATH, 'graph');

const { repos, total_files } = scanRepoFiles(DEVMIND_PATH);

interface RepoResult {
  repo: string;
  repoPath: string;
  totalIndexable: number;
  present: number;
  missing: string[]; // relative paths (real source path)
}

const results: RepoResult[] = [];
let grandTotal = 0;
let grandMissing = 0;

for (const r of repos) {
  const missing: string[] = [];
  let present = 0;

  for (const absFile of r.files) {
    const rel = path.relative(r.repo_path, absFile); // e.g. src\functions\Foo\app.ts
    const ext = path.extname(rel);
    const relNoExt = rel.slice(0, rel.length - ext.length);
    const graphRel = relNoExt + '.json';
    const graphAbs = path.join(GRAPH_DIR, r.repo_name, graphRel);

    if (fs.existsSync(graphAbs)) {
      present++;
    } else {
      missing.push(rel);
    }
  }

  results.push({
    repo: r.repo_name,
    repoPath: r.repo_path,
    totalIndexable: r.file_count,
    present,
    missing
  });

  grandTotal += r.file_count;
  grandMissing += missing.length;
}

console.log(`Total indexable files across all repos (per scanner.ts rules): ${total_files}`);
console.log(`Grand total missing from graph/: ${grandMissing} (${((grandMissing / grandTotal) * 100).toFixed(2)}%)`);
console.log('');

for (const r of results) {
  const pct = r.totalIndexable > 0 ? ((r.missing.length / r.totalIndexable) * 100).toFixed(2) : '0.00';
  console.log(`=== ${r.repo} ===`);
  console.log(`  repo path      : ${r.repoPath}`);
  console.log(`  indexable files: ${r.totalIndexable}`);
  console.log(`  present in graph: ${r.present}`);
  console.log(`  missing        : ${r.missing.length} (${pct}%)`);
  if (r.missing.length > 0) {
    for (const m of r.missing) {
      console.log(`    - ${m}`);
    }
  }
  console.log('');
}

fs.writeFileSync(
  path.join(__dirname, 'missing-graph-files-result.json'),
  JSON.stringify(results, null, 2)
);
console.log('Full JSON result written to scratch/missing-graph-files-result.json');
