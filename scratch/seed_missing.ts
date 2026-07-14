import * as path from 'path';
import { DevMindDatabase } from '../src/db/database';
const ROOT = path.resolve('scratch/missing-test');
const db = new DevMindDatabase(path.join(ROOT,'.devmind','brain.db'));
const id = '{shop}/src/consumer.ts#checkout';
db.upsertNode({ id, name:'checkout', type:'function', file_path: path.join(ROOT,'shop','src','consumer.ts') });
db.updateHistory({ node_id:id, code_snapshot:'export function checkout(p){ return computeDiscount(p); }', reasoning:{what_changed:'s',why:'s',goal:'s',developer:'s',model:'s'} });
db.close();
console.log('seeded 1 node (checkout); computeDiscount intentionally missing');
