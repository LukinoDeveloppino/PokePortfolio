// ════════════════════════════════════════════════════════════════════
// setup.js — DATABASE DI TEST
// ════════════════════════════════════════════════════════════════════
// Caricato con --import prima di ogni file di test: punta DATABASE_URL a
// un database "<nome>_test" sullo stesso server (creandolo se manca), così
// i test possono svuotare le tabelle senza toccare i dati di sviluppo.
// ════════════════════════════════════════════════════════════════════

import pg from 'pg';

const originale = process.env.DATABASE_URL;
if (!originale) throw new Error('DATABASE_URL non impostata: avvia il database (npm run db:local) e crea .env');

const url = new URL(originale);
const nomeDb = url.pathname.slice(1) + '_test';
const client = new pg.Client(originale);
await client.connect();
const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [nomeDb]);
if (!rowCount) await client.query(`CREATE DATABASE "${nomeDb}"`);
await client.end();

url.pathname = '/' + nomeDb;
process.env.DATABASE_URL = url.toString();
process.env.CARDTRADER_DEFAULT_TOKEN = 'token-di-test';
process.env.CRON_SECRET = 'segreto-di-test';
process.env.TZ = 'Europe/Rome';
// I test fanno molti login di seguito: il limite si prova a parte.
process.env.LIMITE_ACCESSI_AL_MINUTO = '1000';
