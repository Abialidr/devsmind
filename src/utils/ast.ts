import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { loadProjectContext, resolveRepoPath } from './config';

interface ParsedNodeId {
  repo: string;
  filePath: string;
  symbolName: string;
  className?: string;
  memberName?: string;
}

interface ImportInfo {
  importedName: string;
  moduleSpecifier: string;
  isDefault: boolean;
}

/**
 * Parses a DevsMind node ID into constituent parts
 */
export function parseNodeId(id: string): ParsedNodeId | null {
  // Matches e.g., "{harrir-backend-products-service}/src/controllers/SearchIndexController.ts#SearchIndexController.searchFiltersV2"
  const match = id.match(/^\{([^}]+)\}\/([^#]+)#(.+)$/);
  if (!match) return null;
  const [, repo, filePath, symbolName] = match;
  const parts = symbolName.split('.');
  if (parts.length === 2) {
    return { repo, filePath, symbolName, className: parts[0], memberName: parts[1] };
  }
  return { repo, filePath, symbolName };
}

/**
 * Resolves path aliases and relative paths to match target files
 */
function matchPaths(resolvedImport: string, targetFile: string): boolean {
  const cleanImport = resolvedImport.replace(/\\/g, '/').toLowerCase();
  const cleanTarget = targetFile.replace(/\\/g, '/').toLowerCase();
  
  // Strip extensions and standard index file conventions
  const importBase = cleanImport.replace(/\.(d\.)?[jt]sx?$/, '').replace(/\/index$/, '');
  const targetBase = cleanTarget.replace(/\.(d\.)?[jt]sx?$/, '').replace(/\/index$/, '');
  
  return importBase === targetBase || cleanImport === cleanTarget;
}

/**
 * Extracts imports from a TypeScript AST SourceFile
 */
function getFileImports(sourceFile: ts.SourceFile): ImportInfo[] {
  const imports: ImportInfo[] = [];

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const moduleSpecifier = node.moduleSpecifier.text;
        if (node.importClause) {
          // Default import: import X from 'y'
          if (node.importClause.name) {
            imports.push({
              importedName: node.importClause.name.text,
              moduleSpecifier,
              isDefault: true
            });
          }
          // Named imports: import { A, B as C } from 'y'
          if (node.importClause.namedBindings) {
            const bindings = node.importClause.namedBindings;
            if (ts.isNamedImports(bindings)) {
              for (const element of bindings.elements) {
                imports.push({
                  importedName: element.name.text,
                  moduleSpecifier,
                  isDefault: false
                });
              }
            } else if (ts.isNamespaceImport(bindings)) {
              // import * as X from 'y'
              imports.push({
                importedName: bindings.name.text,
                moduleSpecifier,
                isDefault: false
              });
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  ts.forEachChild(sourceFile, visit);
  return imports;
}

/**
 * Traverses a TypeScript AST node to collect all referenced names (identifiers & properties)
 */
function collectReferencedNames(root: ts.Node): Set<string> {
  const names = new Set<string>();

  function visit(node: ts.Node) {
    if (ts.isIdentifier(node)) {
      names.add(node.text);
    } else if (ts.isPropertyAccessExpression(node)) {
      if (node.name && ts.isIdentifier(node.name)) {
        names.add(node.name.text);
      }
    } else if (ts.isJsxOpeningElement(node)) {
      if (node.tagName && ts.isIdentifier(node.tagName)) {
        names.add(node.tagName.text);
      }
    } else if (ts.isJsxSelfClosingElement(node)) {
      if (node.tagName && ts.isIdentifier(node.tagName)) {
        names.add(node.tagName.text);
      }
    }
    ts.forEachChild(node, visit);
  }

  ts.forEachChild(root, visit);
  return names;
}

/**
 * Searches for a class method, function, or block inside the file AST matching our symbol name
 */
function findNodeInAst(sourceFile: ts.SourceFile, className: string | undefined, symbolName: string): ts.Node | null {
  let foundNode: ts.Node | null = null;

  function visit(node: ts.Node) {
    if (foundNode) return;

    if (className) {
      if (ts.isClassDeclaration(node) && node.name && node.name.text === className) {
        // Search methods / properties of the class
        for (const member of node.members) {
          if (member.name && ts.isIdentifier(member.name) && member.name.text === symbolName.split('.').pop()) {
            foundNode = member;
            return;
          }
        }
      }
    } else {
      if (
        (ts.isFunctionDeclaration(node) || 
         ts.isClassDeclaration(node) || 
         ts.isInterfaceDeclaration(node) || 
         ts.isTypeAliasDeclaration(node) || 
         ts.isEnumDeclaration(node)) && 
        node.name && node.name.text === symbolName
      ) {
        foundNode = node;
        return;
      }
      if (ts.isVariableDeclaration(node) && node.name && ts.isIdentifier(node.name) && node.name.text === symbolName) {
        foundNode = node;
        return;
      }
    }

    ts.forEachChild(node, visit);
  }

  ts.forEachChild(sourceFile, visit);
  return foundNode;
}

/**
 * Generically extracts identifiers from non-JS/TS code files using regex
 */
function collectRegexNames(code: string): Set<string> {
  const names = new Set<string>();
  
  // Strip block/line comments and string literals to reduce noise
  const cleanCode = code
    .replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, '') // C-style comments
    .replace(/#.*$/gm, '') // Scripting-style comments
    .replace(/(["'])(?:(?=(\\?))\2.)*?\1/g, ''); // String literals

  // Match words that look like identifiers/variables/method names (alphanumeric + underscores)
  const matches = cleanCode.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g);
  if (matches) {
    for (const m of matches) {
      names.add(m);
    }
  }
  return names;
}

/**
 * Locally analyzes the source file and resolves references to candidate nodes
 */
export function resolveConnectionsLocally(
  sourceNodeId: string,
  sourceFilePath: string,
  candidateNodes: { id: string; name: string; type: string; file_path: string }[],
  devmindPath: string
): string[] {
  const parsedSource = parseNodeId(sourceNodeId);
  if (!parsedSource) return [];

  const connections = new Set<string>();

  // Determine repository root path for non-relative imports
  let repoRoot = '';
  try {
    const context = loadProjectContext(devmindPath);
    repoRoot = resolveRepoPath(context, parsedSource.repo) || '';
  } catch (err) {
    // Fallback if config loading fails
  }

  // Check if file exists
  if (!fs.existsSync(sourceFilePath)) {
    return [];
  }

  const fileContent = fs.readFileSync(sourceFilePath, 'utf-8');
  const ext = path.extname(sourceFilePath).toLowerCase();
  const isTsOrJs = ['.ts', '.tsx', '.js', '.jsx'].includes(ext);

  let referencedNames = new Set<string>();
  let imports: ImportInfo[] = [];

  if (isTsOrJs) {
    try {
      const sourceFile = ts.createSourceFile(sourceFilePath, fileContent, ts.ScriptTarget.Latest, true);
      imports = getFileImports(sourceFile);
      
      // Locate the AST node for this class/method/function
      const astNode = findNodeInAst(sourceFile, parsedSource.className, parsedSource.symbolName);
      if (astNode) {
        referencedNames = collectReferencedNames(astNode);
      } else {
        // Fallback: Parse the file's top level if we can't isolate the AST node
        referencedNames = collectReferencedNames(sourceFile);
      }
    } catch (err) {
      // TS AST fallback to regex in case of parsing failures
      referencedNames = collectRegexNames(fileContent);
    }
  } else {
    // Non-JS/TS code uses regex identifier matching
    referencedNames = collectRegexNames(fileContent);
  }

  const sourceDir = path.dirname(sourceFilePath);
  const commonNames = new Set([
    'constructor', 'properties', 'description', 'connections', 'environment', 
    'milliseconds', 'get', 'set', 'find', 'create', 'update', 'delete', 
    'handle', 'process', 'init', 'main', 'config', 'data', 'response', 'request',
    'metadata', 'options', 'headers', 'params', 'payload', 'result', 'status',
    'message', 'details', 'values', 'service', 'controller', 'repository', 'helper',
    'utils', 'constant', 'constants', 'default', 'export', 'import', 'index',
    'keys', 'types', 'validate', 'resolve', 'reject', 'execute', 'loading', 'active'
  ]);

  for (const targetNode of candidateNodes) {
    if (targetNode.id === sourceNodeId) continue;

    const parsedTarget = parseNodeId(targetNode.id);
    if (!parsedTarget) continue;

    const isSameFile = path.resolve(targetNode.file_path) === path.resolve(sourceFilePath);
    const symbolName = parsedTarget.symbolName;
    const memberName = parsedTarget.memberName;
    const className = parsedTarget.className;

    if (isSameFile) {
      // Local dependency within same file
      const nameToCheck = memberName || symbolName;
      if (referencedNames.has(nameToCheck)) {
        connections.add(targetNode.id);
      }
      continue;
    }

    // Different files: cross-file reference validation
    let isImported = false;
    let importedAsNames: string[] = [];

    // Check imports for TS/JS
    if (isTsOrJs && imports.length > 0) {
      for (const imp of imports) {
        let resolvedImportPath = '';
        if (imp.moduleSpecifier.startsWith('.')) {
          resolvedImportPath = path.resolve(sourceDir, imp.moduleSpecifier);
        } else if (repoRoot) {
          resolvedImportPath = path.resolve(repoRoot, imp.moduleSpecifier);
        }

        if (resolvedImportPath && matchPaths(resolvedImportPath, targetNode.file_path)) {
          isImported = true;
          importedAsNames.push(imp.importedName);
        }
      }
    }

    if (isImported) {
      if (memberName) {
        // e.g. Class.method: check if Class name was imported, and method name was referenced
        if (className && importedAsNames.includes(className) && referencedNames.has(memberName)) {
          connections.add(targetNode.id);
          continue;
        }
        // Or if the method itself is imported/referenced
        if (importedAsNames.includes(memberName) || referencedNames.has(memberName)) {
          connections.add(targetNode.id);
          continue;
        }
      } else {
        // Top-level function/variable imported & referenced
        if (importedAsNames.includes(symbolName) && referencedNames.has(symbolName)) {
          connections.add(targetNode.id);
          continue;
        }
      }
    }

    // Fallback: Only allow for top-level, non-class symbols (no className)
    // within the same repository, and require it to be very specific/long (length >= 16).
    if (!className && parsedSource.repo === parsedTarget.repo) {
      const nameToCheck = symbolName;
      if (nameToCheck.length >= 16 && referencedNames.has(nameToCheck)) {
        if (!commonNames.has(nameToCheck.toLowerCase())) {
          connections.add(targetNode.id);
        }
      }
    }
  }

  return Array.from(connections);
}
