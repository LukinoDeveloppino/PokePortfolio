// Richiede un PostgreSQL raggiungibile su DATABASE_URL (es. npm run db:local).

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db/pool.js';

const app = buildApp({ logger: false });

after(async () => {
  await app.close();
  await pool.end();
});

test('GET /api/health risponde ok quando il database è raggiungibile', async () => {
  const risposta = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(risposta.statusCode, 200);
  assert.deepEqual(risposta.json(), { status: 'ok', database: 'ok' });
});
