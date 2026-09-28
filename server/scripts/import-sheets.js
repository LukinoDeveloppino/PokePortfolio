// ════════════════════════════════════════════════════════════════════
// import-sheets.js — IMPORTA GLI EXPORT .xlsx DELLA VERSIONE GOOGLE SHEETS
// ════════════════════════════════════════════════════════════════════
//   npm run import                 legge la cartella ./import
//   npm run import -- <cartella>
//
// Nella cartella servono:
//   • il foglio master: il file con "master" nel nome
//     (Google lo chiama "PokePortfolio - Master.xlsx");
//   • un file per utente: "PokePortfolio-<username>.xlsx".
// ════════════════════════════════════════════════════════════════════

import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../src/db/pool.js';
import { applicaMigrazioni } from '../src/db/migrate.js';
import { leggiMaster, leggiFileUtente, importa } from '../src/import/sheets.js';

const cartella = path.resolve(process.argv[2] || 'import');
const FILE_UTENTE = /^PokePortfolio-(.+)\.xlsx$/i;

let codiceUscita = 0;
try {
  const file = (await readdir(cartella)).filter((f) => f.toLowerCase().endsWith('.xlsx') && !f.startsWith('~$'));
  const fileMaster = file.filter((f) => /master/i.test(f));
  if (fileMaster.length !== 1) {
    throw new Error(`In ${cartella} serve esattamente un file con "master" nel nome (trovati: ${fileMaster.length}).`);
  }

  console.log(`[IMPORT] Master: ${fileMaster[0]}`);
  const master = await leggiMaster(path.join(cartella, fileMaster[0]));
  console.log(`[IMPORT] ${master.utenti.length} utenti, ${master.sets.length} set, ${master.carte.length} carte`);

  const fileUtenti = {};
  for (const nome of file) {
    const corrispondenza = nome.match(FILE_UTENTE);
    if (!corrispondenza || fileMaster.includes(nome)) continue;
    fileUtenti[corrispondenza[1].trim().toLowerCase()] = await leggiFileUtente(path.join(cartella, nome));
    console.log(`[IMPORT] Utente: ${nome}`);
  }

  await applicaMigrazioni();
  const riepilogo = await importa(master, fileUtenti);

  console.log('[IMPORT] Completato:');
  console.log(`  set ${riepilogo.sets}, carte ${riepilogo.carte}, utenti ${riepilogo.utenti}`);
  console.log(`  voci ${riepilogo.voci}, punti di storico ${riepilogo.puntiStorico}, valori del portfolio ${riepilogo.valori}`);
  for (const avviso of riepilogo.avvisi) console.warn(`  ATTENZIONE: ${avviso}`);
  console.log('Gli utenti accedono con la password di prima.');
} catch (errore) {
  console.error(`[IMPORT] Fallito, database invariato: ${errore.message}`);
  codiceUscita = 1;
} finally {
  await pool.end();
}
process.exit(codiceUscita);
