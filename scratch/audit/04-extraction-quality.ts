import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const DB_PATH = 'C:/work/Hanoot/backend/lamda/harrir-docs-information/harrir-brains/.devmind/brain.db';
const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

const REPOS = [
  'harrir-backend-order-service',
  'harrir-backend-products-service',
  'harrir-backend-user-service',
  'harrir-backend-zoho-service',
  'harrir-express-backend',
  'harrir-mini-app',
  'harrir-web',
  'harrir-web-admin'
];

const nodes = db.prepare('SELECT id, type, name, file_path FROM nodes WHERE deprecated = 0').all() as any[];
const nodesByFile = new Map<string, any[]>();
for (const n of nodes) {
  const key = n.file_path.toLowerCase();
  if (!nodesByFile.has(key)) nodesByFile.set(key, []);
  nodesByFile.get(key)!.push(n);
}

function repoOf(nodeId: string): string | null {
  const m = nodeId.match(/^\{([^}]+)\}\//);
  return m ? m[1] : null;
}

// ---- Expected-construct counter (approximates a well-behaved extractor) ----
interface Expected {
  functions: number; // top-level fn decl/const-arrow/const-fn-expr
  classes: number;
  methodsInClasses: number;
  interfaces: number;
  typeAliases: number;
  enums: number;
  topLevelConstsVars: number; // non-function-valued top-level const/let (excl. destructured requires)
  total: number;
}

function countExpected(sf: ts.SourceFile): Expected {
  const e: Expected = { functions: 0, classes: 0, methodsInClasses: 0, interfaces: 0, typeAliases: 0, enums: 0, topLevelConstsVars: 0, total: 0 };

  function visitTopLevel(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name) {
      e.functions++;
    } else if (ts.isClassDeclaration(node)) {
      e.classes++;
      for (const m of node.members) {
        if (ts.isMethodDeclaration(m) || ts.isGetAccessorDeclaration(m) || ts.isSetAccessorDeclaration(m)) {
          e.methodsInClasses++;
        }
      }
    } else if (ts.isInterfaceDeclaration(node)) {
      e.interfaces++;
    } else if (ts.isTypeAliasDeclaration(node)) {
      e.typeAliases++;
    } else if (ts.isEnumDeclaration(node)) {
      e.enums++;
    } else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue; // skip destructuring (require(...) etc.)
        const init = decl.initializer;
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          e.functions++;
        } else if (init && ts.isClassExpression(init)) {
          e.classes++;
        } else if (init && ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === 'require') {
          // require(...) import-equivalent, not a real construct
        } else {
          e.topLevelConstsVars++;
        }
      }
    } else if (ts.isExportAssignment(node)) {
      // export default X — not separately counted (bound to whatever X is)
    }
  }

  for (const stmt of sf.statements) {
    // Handle `export default class/function` and plain declarations uniformly
    visitTopLevel(stmt);
    // module.exports = { a, b } patterns / IIFEs are not unwrapped — out of scope for this heuristic
  }

  e.total = e.functions + e.classes + e.methodsInClasses + e.interfaces + e.typeAliases + e.enums + e.topLevelConstsVars;
  return e;
}

function loadFilesForRepo(repoPath: string): { abs: string; lines: number }[] {
  const out: { abs: string; lines: number }[] = [];
  const IGNORE_DIRS = new Set(['node_modules', 'dist', 'build', '.next', '.git', 'coverage', '.serverless']);
  function walk(dir: string) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      if (IGNORE_DIRS.has(ent.name)) continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|jsx)$/.test(ent.name) && !/\.d\.ts$/.test(ent.name)) {
        try {
          const content = fs.readFileSync(p, 'utf-8');
          out.push({ abs: p, lines: content.split('\n').length });
        } catch { /* ignore */ }
      }
    }
  }
  walk(repoPath);
  return out;
}

const REPO_PATHS: Record<string, string> = {
  'harrir-backend-order-service': 'C:/work/Hanoot/backend/lamda/harrir-backend-order-service',
  'harrir-backend-products-service': 'C:/work/Hanoot/backend/lamda/harrir-backend-products-service',
  'harrir-backend-user-service': 'C:/work/Hanoot/backend/lamda/harrir-backend-user-service',
  'harrir-backend-zoho-service': 'C:/work/Hanoot/backend/lamda/harrir-backend-zoho-service',
  'harrir-express-backend': 'C:/work/Hanoot/backend/lamda/harrir-express-backend',
  'harrir-mini-app': 'C:/work/Hanoot/backend/lamda/harrir-mini-app',
  'harrir-web': 'C:/work/Hanoot/backend/lamda/harrir-web',
  'harrir-web-admin': 'C:/work/Hanoot/backend/lamda/harrir-web-admin'
};

// Deterministic pseudo-random pick without Math.random (not banned here since this is a plain
// node script, not a Workflow script — but keep it deterministic & simple anyway)
function pickStratified(files: { abs: string; lines: number }[], n: number): { abs: string; lines: number }[] {
  const sorted = [...files].sort((a, b) => a.lines - b.lines);
  if (sorted.length <= n) return sorted;
  const picks: { abs: string; lines: number }[] = [];
  // Always include largest and smallest (with >0 lines) for range coverage
  const nonEmpty = sorted.filter(f => f.lines > 3);
  picks.push(nonEmpty[0]); // smallest meaningful
  picks.push(nonEmpty[nonEmpty.length - 1]); // largest
  // Then spread remaining picks evenly across percentiles
  const remaining = n - picks.length;
  for (let i = 1; i <= remaining; i++) {
    const idx = Math.floor((i / (remaining + 1)) * nonEmpty.length);
    const f = nonEmpty[Math.min(idx, nonEmpty.length - 1)];
    if (!picks.includes(f)) picks.push(f);
  }
  // Dedup and pad if collisions reduced count
  const uniq = [...new Set(picks)];
  let idx2 = Math.floor(nonEmpty.length / 2);
  while (uniq.length < n && idx2 < nonEmpty.length) {
    if (!uniq.includes(nonEmpty[idx2])) uniq.push(nonEmpty[idx2]);
    idx2++;
  }
  return uniq.slice(0, n);
}

const SAMPLE_PER_REPO = 5;
const results: any[] = [];

for (const repo of REPOS) {
  const repoPath = REPO_PATHS[repo];
  const files = loadFilesForRepo(repoPath);
  const sample = pickStratified(files, SAMPLE_PER_REPO);

  console.log(`\n=== ${repo} — sampled ${sample.length}/${files.length} files ===`);

  for (const f of sample) {
    const key = f.abs.toLowerCase();
    const actualNodes = nodesByFile.get(key) || [];
    const actualByType: Record<string, number> = {};
    for (const n of actualNodes) actualByType[n.type] = (actualByType[n.type] || 0) + 1;

    let expected: Expected | null = null;
    const ext = path.extname(f.abs).toLowerCase();
    if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
      try {
        const content = fs.readFileSync(f.abs, 'utf-8');
        const sf = ts.createSourceFile(f.abs, content, ts.ScriptTarget.Latest, true);
        expected = countExpected(sf);
      } catch (e) {
        expected = null;
      }
    }

    const actualTotal = actualNodes.length;
    const expectedTotal = expected ? expected.total : -1;
    let ratio: number | null = expectedTotal > 0 ? actualTotal / expectedTotal : (expectedTotal === 0 ? (actualTotal === 0 ? 1 : Infinity) : null);
    let flag = 'OK';
    if (expectedTotal === 0 && actualTotal > 3) flag = 'OVER (expected ~0 top-level constructs but nodes exist — likely nested/nonstandard extraction)';
    else if (expectedTotal > 0 && ratio !== null) {
      if (ratio < 0.4) flag = 'UNDER-EXTRACTED';
      else if (ratio > 2.2) flag = 'OVER-EXTRACTED';
    }

    const rel = path.relative(repoPath, f.abs).replace(/\\/g, '/');
    console.log(`  [${flag}] ${rel} (lines=${f.lines})  expected_total=${expectedTotal} actual_total=${actualTotal} ratio=${ratio === null ? 'n/a' : (ratio === Infinity ? 'inf' : ratio.toFixed(2))}`);
    console.log(`      expected breakdown: ${expected ? JSON.stringify(expected) : 'n/a'}`);
    console.log(`      actual breakdown:   ${JSON.stringify(actualByType)}`);

    results.push({
      repo, file: rel, absPath: f.abs, lines: f.lines,
      expected, actualTotal, actualByType, ratio: ratio === Infinity ? null : ratio, flag
    });
  }
}

fs.writeFileSync(path.join(__dirname, 'extraction-quality-output.json'), JSON.stringify(results, null, 2));
console.log(`\nTotal files sampled: ${results.length}`);
db.close();
