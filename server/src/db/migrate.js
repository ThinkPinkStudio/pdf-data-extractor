import 'dotenv/config';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';
import pg from 'pg';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { Client } = pg;

async function migrate() {
  const client = new Client({ connectionString: config.DATABASE_URL });
  await client.connect();
  console.log('Connesso a PostgreSQL, avvio migrazione...');
  try {
    const sql = await readFile(path.join(__dirname, 'schema.sql'), 'utf8');
    await client.query(sql);
    console.log('✅ Migrazione completata.');
  } finally {
    await client.end();
  }
}

migrate().catch(err => {
  console.error('❌ Migrazione fallita:', err.message);
  process.exit(1);
});
