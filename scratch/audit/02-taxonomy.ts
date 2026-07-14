import Database from 'better-sqlite3';

const DB_PATH = 'C:/work/Hanoot/backend/lamda/harrir-docs-information/harrir-brains/.devmind/brain.db';
const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

// Exact taxonomy from src/cli/runner.ts TAXONOMY_PROMPT
const TAXONOMY = `
UNIVERSAL: function | method | class | abstract_class | interface | type_alias | enum | constant | variable | module | namespace | decorator
NESTJS: nest_module | nest_controller | nest_service | nest_provider | nest_guard | nest_interceptor | nest_pipe | nest_filter | nest_decorator | nest_middleware | nest_gateway | nest_resolver | nest_schema | nest_dto
EXPRESS/FASTIFY: route_handler | middleware | router
SPRING: spring_controller | spring_service | spring_repository | spring_component | spring_bean | spring_config | spring_entity
DJANGO/FASTAPI: django_view | django_model | django_serializer | django_form | django_signal | fastapi_router | fastapi_dependency
GO: go_handler | go_middleware | go_struct | go_interface | go_func
RUST: rust_struct | rust_impl | rust_trait | rust_enum | rust_fn | rust_macro
REACT/NEXTJS: react_component | react_hook | react_context | react_hoc | react_page | next_page | next_layout | next_api_route | next_server_action
ORM: prisma_model | typeorm_entity | mongoose_model | sqlalchemy_model
REST/API/GRAPHQL: api_endpoint | rest_controller | graphql_resolver | graphql_query | graphql_mutation | graphql_schema
CLI: cli_command | cli_option
UTILITY: util_function | helper | validator | formatter
`;

const VALID_TYPES = new Set<string>();
for (const line of TAXONOMY.split('\n')) {
  const idx = line.indexOf(':');
  if (idx === -1) continue;
  const rhs = line.slice(idx + 1);
  for (const t of rhs.split('|')) {
    const v = t.trim();
    if (v) VALID_TYPES.add(v);
  }
}
console.log('Valid taxonomy types count:', VALID_TYPES.size);
console.log([...VALID_TYPES].sort().join(', '));

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

const nodes = db.prepare('SELECT id, type, name FROM nodes WHERE deprecated = 0').all() as any[];

console.log('\n=== PER REPO TAXONOMY CONFORMANCE ===');
let aggTotal = 0, aggConform = 0;
const aggOffTypes = new Map<string, number>();
const aggOffExamples = new Map<string, string[]>();

for (const repo of REPOS) {
  const repoNodes = nodes.filter(n => repoOf(n.id) === repo);
  const total = repoNodes.length;
  const offTypes = new Map<string, number>();
  const offExamples = new Map<string, string[]>();
  let conform = 0;
  for (const n of repoNodes) {
    if (VALID_TYPES.has(n.type)) {
      conform++;
    } else {
      offTypes.set(n.type, (offTypes.get(n.type) || 0) + 1);
      const arr = offExamples.get(n.type) || [];
      if (arr.length < 3) arr.push(n.id);
      offExamples.set(n.type, arr);

      aggOffTypes.set(n.type, (aggOffTypes.get(n.type) || 0) + 1);
      const aarr = aggOffExamples.get(n.type) || [];
      if (aarr.length < 3) aarr.push(n.id);
      aggOffExamples.set(n.type, aarr);
    }
  }
  aggTotal += total;
  aggConform += conform;
  console.log(`\n--- ${repo} ---`);
  console.log(`  total: ${total}  conforming: ${conform} (${total ? (100*conform/total).toFixed(2) : '0'}%)`);
  if (offTypes.size) {
    console.log('  off-taxonomy types:');
    for (const [t, c] of [...offTypes.entries()].sort((a,b)=>b[1]-a[1])) {
      console.log(`    "${t}": ${c}  e.g. ${offExamples.get(t)!.join(' | ')}`);
    }
  }
}

console.log('\n=== AGGREGATE ===');
console.log(`total: ${aggTotal}  conforming: ${aggConform} (${(100*aggConform/aggTotal).toFixed(2)}%)`);
console.log('distinct off-taxonomy types:', aggOffTypes.size);
for (const [t, c] of [...aggOffTypes.entries()].sort((a,b)=>b[1]-a[1])) {
  console.log(`  "${t}": ${c}  e.g. ${aggOffExamples.get(t)!.join(' | ')}`);
}

db.close();
