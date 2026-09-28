// ════════════════════════════════════════════════════════════════════
// import-sheets.js — IMPORTA GLI EXPORT .xlsx DELLA VERSIONE GOOGLE SHEETS
// ════════════════════════════════════════════════════════════════════
//   npm run import                 legge la cartella ./import
//   npm run import -- <cartella>
//   npm run import -- --abbina Astrid=ndelpopolo --abbina Carcio=snorlax
//
// Nella cartella servono:
//   • il foglio master: il file con "master" nel nome
//     (Google lo chiama "PokePortfolio - Master.xlsx");
//   • un file per utente: "PokePortfolio-<nome>.xlsx" (anche "Poké…").
//     Di norma <nome> è lo username del master; se non coincide,
//     --abbina <nome>=<username> dice a quale utente appartiene il file.
// ════════════════════════════════════════════════════════════════════

import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../src/db/pool.js';
import { applicaMigrazioni } from '../src/db/migrate.js';
import { leggiMaster, leggiFileUtente, importa } from '../src/import/sheets.js';

const argomenti = process.argv.slice(2);
const abbinamenti = new Map();
const posizionali = [];
for (let i = 0; i < argomenti.length; i++) {
  if (argomenti[i] === '--abbina') {
    const [nomeFile, username] = String(argomenti[++i] || '').split('=');
    if (!nomeFile || !username) throw new Error('Uso: --abbina <nome nel file>=<username del master>');
    abbinamenti.set(nomeFile.trim().toLowerCase(), username.trim().toLowerCase());
  } else {
    posizionali.push(argomenti[i]);
  }
}

const cartella = path.resolve(posizionali[0] || 'import');
// "Poké" può arrivare con la é composta o come e + accento (NFD).
const FILE_UTENTE = /^Pok[eé]Portfolio-(.+)\.xlsx$/i;

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
    const corrispondenza = nome.normalize('NFC').match(FILE_UTENTE);
    if (!corrispondenza || fileMaster.includes(nome)) continue;
    const nomeNelFile = corrispondenza[1].trim().toLowerCase();
    const username = abbinamenti.get(nomeNelFile) || nomeNelFile;
    if (fileUtenti[username]) throw new Error(`Due file per l'utente "${username}".`);
    fileUtenti[username] = await leggiFileUtente(path.join(cartella, nome));
    console.log(`[IMPORT] ${nome} → utente "${username}"`);
  }
  for (const nomeNelFile of abbinamenti.keys()) {
    if (!file.some((f) => f.normalize('NFC').match(FILE_UTENTE)?.[1].trim().toLowerCase() === nomeNelFile)) {
      throw new Error(`--abbina: nessun file per "${nomeNelFile}".`);
    }
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
