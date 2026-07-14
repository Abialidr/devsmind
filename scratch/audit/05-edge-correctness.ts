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

function repoOf(nodeId: string): string | null {
  const m = nodeId.match(/^\{([^}]+)\}\//);
  return m ? m[1] : null;
}

function parseNodeId(id: string): { repo: string; filePath: string; symbolName: string; className?: string; memberName?: string } | null {
  const match = id.match(/^\{([^}]+)\}\/([^#]+)#(.+)$/);
  if (!match) return null;
  const [, repo, filePath, symbolName] = match;
  const parts = symbolName.split('.');
  if (parts.length === 2) {
    return { repo, filePath, symbolName, className: parts[0], memberName: parts[1] };
  }
  return { repo, filePath, symbolName };
}

// Faithful port of ast.ts's findNodeInAst + its adapters (findRouteCall, findInFrameworkContainer,
// navigateObjectPath, findPropertyInContainer), for independent verification of edge correctness.
function findPropertyInContainer(containerNode: ts.Node, propName: string): ts.Node | null {
  let found: ts.Node | null = null;
  function visit(node: ts.Node) {
    if (found) return;
    if (
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node) || ts.isMethodDeclaration(node)) &&
      node.name && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && node.name.text === propName
    ) { found = node; return; }
    if (
      (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) &&
      node.name && ts.isIdentifier(node.name) && node.name.text === propName
    ) { found = node; return; }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(containerNode, visit);
  return found;
}

function findRouteCall(sourceFile: ts.SourceFile, method: string, arg: string): ts.Node | null {
  let found: ts.Node | null = null;
  function visit(node: ts.Node) {
    if (found) return;
    if (
      ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === method && node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0]) && node.arguments[0].text === arg
    ) { found = node; return; }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sourceFile, visit);
  return found;
}

function navigateObjectPath(obj: ts.ObjectLiteralExpression, segments: string[]): ts.Node | null {
  let current: ts.ObjectLiteralExpression | null = obj;
  for (let i = 0; i < segments.length; i++) {
    if (!current) return null;
    const seg = segments[i];
    const prop = current.properties.find(
      p => p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === seg
    );
    if (!prop) return null;
    if (i === segments.length - 1) return prop;
    if (ts.isPropertyAssignment(prop) && ts.isObjectLiteralExpression(prop.initializer)) {
      current = prop.initializer;
    } else {
      current = null;
    }
  }
  return null;
}

function findInFrameworkContainer(sourceFile: ts.SourceFile, segments: string[]): ts.Node | null {
  if (segments.length === 0) return null;
  const objArgs: ts.ObjectLiteralExpression[] = [];
  for (const stmt of sourceFile.statements) {
    let expr: ts.Expression | undefined;
    if (ts.isExpressionStatement(stmt)) expr = stmt.expression;
    else if (ts.isExportAssignment(stmt)) expr = stmt.expression;
    if (expr && ts.isCallExpression(expr)) {
      for (const a of expr.arguments) if (ts.isObjectLiteralExpression(a)) objArgs.push(a);
    }
  }
  for (const obj of objArgs) {
    const node = navigateObjectPath(obj, segments);
    if (node) return node;
  }
  const last = segments[segments.length - 1];
  for (const obj of objArgs) {
    const node = findPropertyInContainer(obj, last);
    if (node) return node;
  }
  return null;
}

function findNodeInAst(sourceFile: ts.SourceFile, className: string | undefined, symbolName: string): ts.Node | null {
  const routeMatch = symbolName.match(/^\w+\.\w+\((['"])(.+)\1\)$/);
  if (routeMatch) {
    const method = symbolName.slice(symbolName.indexOf('.') + 1, symbolName.indexOf('('));
    const routeCall = findRouteCall(sourceFile, method, routeMatch[2]);
    if (routeCall) return routeCall;
  }

  let foundNode: ts.Node | null = null;
  let containerCandidate: ts.Node | null = null;

  function visit(node: ts.Node) {
    if (foundNode) return;
    if (className) {
      if (ts.isClassDeclaration(node) && node.name && node.name.text === className) {
        for (const member of node.members) {
          if (member.name && ts.isIdentifier(member.name) && member.name.text === symbolName.split('.').pop()) {
            foundNode = member;
            return;
          }
        }
      }
      if (
        !containerCandidate &&
        ((ts.isVariableDeclaration(node) && node.name && ts.isIdentifier(node.name) && node.name.text === className) ||
         (ts.isFunctionDeclaration(node) && node.name && node.name.text === className) ||
         (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === className))
      ) {
        containerCandidate = node;
      }
    } else {
      if (
        (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) ||
         ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) &&
        (node as any).name && (node as any).name.text === symbolName
      ) { foundNode = node; return; }
      if (ts.isVariableDeclaration(node) && node.name && ts.isIdentifier(node.name) && node.name.text === symbolName) {
        foundNode = node; return;
      }
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(sourceFile, visit);

  if (!foundNode && className && containerCandidate) {
    const memberName = symbolName.includes('.') ? symbolName.split('.').pop()! : symbolName;
    foundNode = findPropertyInContainer(containerCandidate, memberName);
  }

  if (!foundNode && symbolName.includes('.')) {
    const segments = symbolName.split('.');
    foundNode = findInFrameworkContainer(sourceFile, segments.slice(1));
  }

  return foundNode;
}

interface EdgeSample {
  repo: string;
  source: any;
  target: any;
}

const allConns = db.prepare(`
  SELECT c.source_node_id, c.target_node_id,
         sn.name as source_name, sn.type as source_type, sn.file_path as source_file,
         tn.name as target_name, tn.type as target_type, tn.file_path as target_file
  FROM node_connections c
  JOIN nodes sn ON sn.id = c.source_node_id
  JOIN nodes tn ON tn.id = c.target_node_id
`).all() as any[];

const byRepo = new Map<string, any[]>();
for (const c of allConns) {
  const r = repoOf(c.source_node_id);
  if (!r) continue;
  if (!byRepo.has(r)) byRepo.set(r, []);
  byRepo.get(r)!.push(c);
}

const PER_REPO_SAMPLE = 8;
const results: any[] = [];

for (const repo of REPOS) {
  const conns = byRepo.get(repo) || [];
  // Deterministic stratified pick: evenly spaced indices through the list
  const n = Math.min(PER_REPO_SAMPLE, conns.length);
  const picks: any[] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.floor((i / n) * conns.length);
    picks.push(conns[idx]);
  }

  console.log(`\n=== ${repo}: sampling ${picks.length}/${conns.length} edges ===`);

  for (const c of picks) {
    const parsedSrc = parseNodeId(c.source_node_id);
    const parsedTgt = parseNodeId(c.target_node_id);
    let verdict = 'UNKNOWN';
    let detail = '';

    if (!parsedSrc || !parsedTgt) {
      verdict = 'PARSE_ERROR';
    } else {
      try {
        const srcPaths = c.source_file.split(',').map((s: string) => s.trim()).filter(Boolean);
        const srcAbs = srcPaths[0];
        const ext = path.extname(srcAbs).toLowerCase();
        if (!['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
          verdict = 'NON_TS_SKIP';
        } else if (!fs.existsSync(srcAbs)) {
          verdict = 'SOURCE_FILE_MISSING';
        } else {
          const content = fs.readFileSync(srcAbs, 'utf-8');
          const sf = ts.createSourceFile(srcAbs, content, ts.ScriptTarget.Latest, true);
          const astNode = findNodeInAst(sf, parsedSrc.className, parsedSrc.symbolName);
          if (!astNode) {
            verdict = 'SOURCE_SYMBOL_NOT_ISOLATED';
            detail = 'Could not locate the specific declaration in source AST (whole-file fallback would be used)';
          } else {
            const bodyText = astNode.getText(sf);
            const nameToCheck = parsedTgt.memberName || parsedTgt.symbolName;
            // whole-word match
            const re = new RegExp(`\\b${nameToCheck.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
            const isSameFile = path.resolve(srcAbs).toLowerCase() === path.resolve(c.target_file.split(',')[0].trim()).toLowerCase();
            if (re.test(bodyText)) {
              verdict = 'CONFIRMED_IN_BODY';
            } else {
              verdict = 'NOT_FOUND_IN_BODY';
              detail = `target name "${nameToCheck}" not found as identifier within isolated body (${bodyText.length} chars). sameFile=${isSameFile}`;
            }
          }
        }
      } catch (e) {
        verdict = 'EXCEPTION';
        detail = (e as Error).message;
      }
    }

    console.log(`  [${verdict}] ${c.source_node_id} -> ${c.target_node_id}${detail ? '  (' + detail + ')' : ''}`);
    results.push({ repo, source: c.source_node_id, target: c.target_node_id, sourceFile: c.source_file, targetFile: c.target_file, sourceType: c.source_type, targetType: c.target_type, verdict, detail });
  }
}

console.log('\n=== SUMMARY PER REPO ===');
const summary: any = {};
for (const repo of REPOS) {
  const r = results.filter(x => x.repo === repo);
  const confirmed = r.filter(x => x.verdict === 'CONFIRMED_IN_BODY').length;
  const notFound = r.filter(x => x.verdict === 'NOT_FOUND_IN_BODY').length;
  const notIsolated = r.filter(x => x.verdict === 'SOURCE_SYMBOL_NOT_ISOLATED').length;
  const other = r.length - confirmed - notFound - notIsolated;
  summary[repo] = { total: r.length, confirmed, notFound, notIsolated, other };
  console.log(`${repo}: total=${r.length} confirmed=${confirmed} notFound=${notFound} notIsolated=${notIsolated} other=${other}`);
}
const totalAll = results.length;
const confirmedAll = results.filter(x => x.verdict === 'CONFIRMED_IN_BODY').length;
console.log(`\nAGGREGATE: total=${totalAll} confirmed=${confirmedAll} (${(100*confirmedAll/totalAll).toFixed(1)}%)`);

fs.writeFileSync(path.join(__dirname, 'edge-correctness-output.json'), JSON.stringify({ results, summary }, null, 2));
db.close();
