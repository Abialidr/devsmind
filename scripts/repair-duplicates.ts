import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';

// Helper to recursively walk a directory and list files
function walkDir(dir: string, ignoredPatterns: string[]): string[] {
  const files: string[] = [];
  
  function scan(currentDir: string) {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return; // ignore unreadable dirs
    }
    
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      
      // Simple ignore check
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      
      let isIgnored = false;
      for (const pattern of ignoredPatterns) {
        if (entry.name === pattern || fullPath.includes(pattern)) {
          isIgnored = true;
          break;
        }
      }
      if (isIgnored) continue;
      
      if (entry.isDirectory()) {
        scan(fullPath);
      } else if (entry.isFile()) {
        // Only scan common code files
        const ext = path.extname(entry.name);
        if (['.ts', '.js', '.tsx', '.jsx', '.go', '.py', '.java', '.rs'].includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  }
  
  scan(dir);
  return files;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('❌ Please specify the path to the .devmind directory.');
    console.error('Usage: npx tsx scripts/repair-duplicates.ts <path-to-.devmind>');
    process.exit(1);
  }
  
  const devmindPath = path.resolve(args[0]);
  if (!fs.existsSync(devmindPath) || !fs.statSync(devmindPath).isDirectory()) {
    console.error(`❌ Path does not exist or is not a directory: ${devmindPath}`);
    process.exit(1);
  }
  
  const dbPath = path.join(devmindPath, 'brain.db');
  const configPath = path.join(devmindPath, 'config.json');
  
  if (!fs.existsSync(dbPath)) {
    console.error(`❌ Database not found at: ${dbPath}`);
    process.exit(1);
  }
  if (!fs.existsSync(configPath)) {
    console.error(`❌ Config not found at: ${configPath}`);
    process.exit(1);
  }
  
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const repos = config.repos || [];
  const ignoredPaths = config.ignored_paths || [];
  
  console.log(`📁 Scanning workspace files for repo folders...`);
  
  // Collect all files in the repository paths
  const allWorkspaceFiles: string[] = [];
  const workspaceRoot = path.dirname(devmindPath); // usually parent of .devmind
  
  for (const repo of repos) {
    const repoPath = path.isAbsolute(repo.relative_path)
      ? repo.relative_path
      : path.resolve(workspaceRoot, repo.relative_path);
      
    if (!fs.existsSync(repoPath)) {
      console.warn(`⚠️ Warning: Repo path does not exist: ${repoPath}`);
      continue;
    }
    
    console.log(`🔍 Scanning: ${repo.name} (${repoPath})`);
    const files = walkDir(repoPath, ignoredPaths);
    allWorkspaceFiles.push(...files);
  }
  
  console.log(`✨ Total code files found in workspace: ${allWorkspaceFiles.length}`);
  
  console.log(`🧠 Connecting to database: ${dbPath}`);
  const db = new Database(dbPath);
  
  // Read all active nodes
  const nodes = db.prepare('SELECT id, name, file_path FROM nodes WHERE deprecated = 0').all() as any[];
  console.log(`📊 Loaded ${nodes.length} nodes from database.`);
  
  console.log(`🔄 Checking nodes for duplicates across files...`);
  
  let updatedCount = 0;
  
  // Prepare queries
  const getLatestCodeStmt = db.prepare(`
    SELECT code_snapshot FROM history 
    WHERE node_id = ? 
    ORDER BY created_at DESC LIMIT 1
  `);
  
  const updateNodePathStmt = db.prepare(`
    UPDATE nodes SET file_path = ? WHERE id = ?
  `);
  
  // Cache file contents to speed up matching
  const fileContentsCache = new Map<string, string>();
  function getFileContent(filePath: string): string {
    if (fileContentsCache.has(filePath)) {
      return fileContentsCache.get(filePath)!;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    fileContentsCache.set(filePath, content);
    return content;
  }
  
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    
    // Get latest code snapshot for the node
    const historyEntry = getLatestCodeStmt.get(node.id) as any;
    if (!historyEntry || !historyEntry.code_snapshot) {
      continue;
    }
    
    const codeSnapshot = String(historyEntry.code_snapshot).trim();
    if (codeSnapshot.length === 0) continue;
    
    // Get the first non-empty line of the snapshot to match
    const lines = codeSnapshot.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    
    // Use the first line or first 60 chars of code snapshot as signature matching string
    const matchSnippet = lines[0].substring(0, 80);
    
    // Find all files that contain this snippet
    const matchingPaths: string[] = [];
    
    for (const filePath of allWorkspaceFiles) {
      try {
        const fileContent = getFileContent(filePath);
        if (fileContent.includes(matchSnippet)) {
          matchingPaths.push(filePath);
        }
      } catch (err) {
        // ignore read errors
      }
    }
    
    if (matchingPaths.length > 1) {
      // Sort paths to keep them consistent
      matchingPaths.sort();
      const combinedPath = matchingPaths.join(', ');
      
      if (node.file_path !== combinedPath) {
        console.log(`🔗 Node [${node.id}] (${node.name}) found in ${matchingPaths.length} files:`);
        matchingPaths.forEach(p => console.log(`   👉 ${path.relative(workspaceRoot, p)}`));
        
        updateNodePathStmt.run(combinedPath, node.id);
        updatedCount++;
      }
    }
    
    if ((i + 1) % 500 === 0) {
      console.log(`   Processed ${i + 1}/${nodes.length} nodes...`);
    }
  }
  
  db.close();
  console.log(`\n🎉 Done! Updated ${updatedCount} nodes with duplicate file paths.`);
}

main().catch(err => {
  console.error('❌ Error running repair script:', err);
  process.exit(1);
});
