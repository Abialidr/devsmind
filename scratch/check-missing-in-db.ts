import Database from 'better-sqlite3';
import * as path from 'path';

const DB_PATH = 'C:\\work\\Hanoot\\backend\\lamda\\harrir-docs-information\\harrir-brains\\.devmind\\brain.db';
const db = new Database(DB_PATH, { readonly: true });

const files = [
  'harrir-backend-products-service\\src\\controllers\\ElasticController.ts',
  'harrir-backend-user-service\\src\\controllers\\api\\v1\\GiniBridgeController.ts',
  'harrir-backend-user-service\\src\\functions\\api\\v1\\GiniCustomerAccounts\\app.ts',
  'harrir-backend-user-service\\src\\functions\\api\\v1\\GiniInstallmentConfirm\\app.ts',
  'harrir-backend-user-service\\src\\functions\\api\\v1\\GiniInstallmentInquiry\\app.ts',
  'harrir-backend-user-service\\src\\functions\\api\\v1\\GiniInstallmentValidate\\app.ts',
  'harrir-backend-user-service\\src\\repositories\\api\\v1\\GiniAccountRepository.ts',
  'harrir-backend-user-service\\src\\services\\api\\v1\\GiniBridgeService.ts',
  'harrir-express-backend\\src\\config\\database.ts',
  'harrir-mini-app\\components\\skeletons\\address-item-skeleton\\address-item-skeleton.js',
  'harrir-web-admin\\app\\(auth)\\login\\page.tsx'
];

const REPO_ROOTS: Record<string, string> = {
  'harrir-backend-order-service': 'C:\\work\\Hanoot\\backend\\lamda\\harrir-backend-order-service',
  'harrir-backend-products-service': 'C:\\work\\Hanoot\\backend\\lamda\\harrir-backend-products-service',
  'harrir-backend-user-service': 'C:\\work\\Hanoot\\backend\\lamda\\harrir-backend-user-service',
  'harrir-backend-zoho-service': 'C:\\work\\Hanoot\\backend\\lamda\\harrir-backend-zoho-service',
  'harrir-express-backend': 'C:\\work\\Hanoot\\backend\\lamda\\harrir-express-backend',
  'harrir-mini-app': 'C:\\work\\Hanoot\\backend\\lamda\\harrir-mini-app',
  'harrir-web': 'C:\\work\\Hanoot\\backend\\lamda\\harrir-web',
  'harrir-web-admin': 'C:\\work\\Hanoot\\backend\\lamda\\harrir-web-admin'
};

for (const f of files) {
  const repo = Object.keys(REPO_ROOTS).find(r => f.startsWith(r + '\\'))!;
  const relInRepo = f.slice(repo.length + 1);
  const absPath = path.join(REPO_ROOTS[repo], relInRepo);

  // Match nodes whose file_path column equals or contains this absolute path (comma-joined lists possible)
  const rows = db.prepare(`
    SELECT id, name, type, deprecated, file_path FROM nodes
    WHERE file_path = ? OR file_path LIKE ? OR file_path LIKE ? OR file_path LIKE ?
  `).all(absPath, `${absPath}, %`, `%, ${absPath}`, `%, ${absPath}, %`) as any[];

  console.log(`\n=== ${f} ===`);
  console.log(`  absPath: ${absPath}`);
  if (rows.length === 0) {
    console.log('  NO rows in DB (active or deprecated) for this file_path.');
  } else {
    for (const r of rows) {
      console.log(`  id=${r.id} name=${r.name} type=${r.type} deprecated=${r.deprecated}`);
    }
  }
}

// Also: any row where file_path LIKE '%GiniBridgeController%' etc, in case path stored differently
console.log('\n--- Fuzzy LIKE scan for "Gini" anywhere in file_path or name ---');
const fuzzy = db.prepare(`SELECT id, name, type, deprecated, file_path FROM nodes WHERE file_path LIKE '%Gini%' OR name LIKE '%Gini%'`).all() as any[];
console.log(`  matches: ${fuzzy.length}`);
for (const r of fuzzy) {
  console.log(`  id=${r.id} name=${r.name} type=${r.type} deprecated=${r.deprecated} file_path=${r.file_path}`);
}

console.log('\n--- Fuzzy LIKE scan for "ElasticController" ---');
const fuzzy2 = db.prepare(`SELECT id, name, type, deprecated, file_path FROM nodes WHERE file_path LIKE '%ElasticController%'`).all() as any[];
console.log(`  matches: ${fuzzy2.length}`);
for (const r of fuzzy2) console.log(`  id=${r.id} name=${r.name} type=${r.type} deprecated=${r.deprecated} file_path=${r.file_path}`);

db.close();
