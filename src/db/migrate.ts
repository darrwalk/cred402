import { readFileSync } from 'fs';
import { join } from 'path';
import { getPool, closeDb } from './client';

async function migrate(): Promise<void> {
  const pool = getPool();
  const sql = readFileSync(join(__dirname, 'migrations', '001_init.sql'), 'utf-8');
  
  console.log('Running migrations...');
  await pool.query(sql);
  console.log('Migrations complete.');
  
  await closeDb();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
