// ════════════════════════════════════════════════════════════════════
// index.js — AVVIO DEL SERVER
// ════════════════════════════════════════════════════════════════════

import { config } from './config.js';
import { pool } from './db/pool.js';
import { applicaMigrazioni } from './db/migrate.js';
import { chiudiJobInterrotti } from './services/jobs.js';
import { assegnaKeyDiDefaultAgliUtentiSenzaKey } from './services/settings.js';
import { avviaScheduler } from './jobs/scheduler.js';
import { avviaSyncTcg, catalogoTcgVuoto } from './services/tcg.js';
import { buildApp } from './app.js';

const app = buildApp();

await applicaMigrazioni(app.log);

// Utenti importati senza API key: ricevono CARDTRADER_DEFAULT_TOKEN (la
// migrazione 002 copre solo il caso in cui la key è in settings).
const senzaKey = await assegnaKeyDiDefaultAgliUtentiSenzaKey();
if (senzaKey) app.log.info(`[UTENTI] API key di default assegnata a ${senzaKey} utenti che non ne avevano una.`);

const interrotti = await chiudiJobInterrotti();
if (interrotti) app.log.warn(`[JOB] ${interrotti} esecuzioni interrotte dall'ultimo arresto chiuse come fallite.`);

const fermaScheduler = config.scheduler ? avviaScheduler(app.log) : () => {};

// Primo avvio con le sezioni Collezione e Mazzi: le carte da gioco si
// scaricano subito, senza aspettare il giro delle 05:30.
if (config.scheduler && await catalogoTcgVuoto()) {
  app.log.info('[TCG] Catalogo delle carte da gioco vuoto: lo scarico adesso.');
  await avviaSyncTcg({ log: app.log });
}

await app.listen({ port: config.port, host: config.host });

// I PaaS fermano il processo con SIGTERM durante deploy e riavvii:
// chiudo prima le richieste in corso, poi le connessioni al database.
for (const segnale of ['SIGINT', 'SIGTERM']) {
  process.once(segnale, async () => {
    app.log.info(`${segnale} ricevuto, arresto in corso`);
    fermaScheduler();
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
