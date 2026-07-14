import Database from 'better-sqlite3';
import { resolveConnectionsLocally, MissingRef } from '../src/utils/ast';

const DEVMIND = 'C:/work/Hanoot/backend/lamda/harrir-docs-information/harrir-brains/.devmind';
const db = new Database(DEVMIND + '/brain.db', { readonly: true });
const all = db.prepare("SELECT id, name, type, file_path FROM nodes WHERE deprecated=0").all() as any[];

const repo = process.argv[2] || 'harrir-backend-order-service';
const srcs = all.filter(n => n.id.startsWith(`{${repo}}/`));
const missing = new Map<string, { file: string; symbol: string; by: Set<string> }>();
const onMissing = (r: MissingRef) => {
  const k = r.targetFile + ' ' + r.name;
  let e = missing.get(k);
  if (!e) { e = { file: r.targetFile, symbol: r.name, by: new Set() }; missing.set(k, e); }
  e.by.add(r.sourceNodeId);
};
for (const s of srcs) resolveConnectionsLocally(s.id, s.file_path, all, DEVMIND, onMissing);

const list = [...missing.values()].sort((a, b) => b.by.size - a.by.size);
console.log(`${repo}: ${list.length} distinct missing (file, symbol) references`);
list.slice(0, 15).forEach(e => {
  const rel = e.file.split(/[\\/]/).slice(-3).join('/');
  console.log(`  ${e.by.size}×  ${e.symbol}   (…/${rel})`);
});
