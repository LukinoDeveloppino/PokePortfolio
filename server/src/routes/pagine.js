// ════════════════════════════════════════════════════════════════════
// pagine.js — PAGINE HTML DEL FRONTEND
// ════════════════════════════════════════════════════════════════════
// Serve HTML/desktop.html e HTML/mobile.html (?mobile=1) così come sono
// nel repository, facendo al posto di HtmlService le due cose che faceva:
//   • sostituisce <?!= include('script'); ?> con HTML/script.html;
//   • aggiunge prima gas-shim.js, che ricrea google.script.run.
// In sviluppo le pagine vengono rilette a ogni richiesta, in produzione
// una volta sola.
// ════════════════════════════════════════════════════════════════════

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const RADICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CARTELLA_HTML = path.join(RADICE, 'HTML');
const CARTELLA_PUBBLICA = path.join(RADICE, 'server', 'public');

// Solo lo scriptlet su una riga a sé: quello nel commento in cima a
// desktop.html va lasciato stare.
const SCRIPTLET_INCLUDE = /^[ \t]*<\?!=\s*include\('script'\);?\s*\?>[ \t]*$/m;

const inProduzione = process.env.NODE_ENV === 'production';
const cache = new Map();

async function componiPagina(nome) {
  if (inProduzione && cache.has(nome)) return cache.get(nome);

  const [pagina, script] = await Promise.all([
    readFile(path.join(CARTELLA_HTML, `${nome}.html`), 'utf8'),
    readFile(path.join(CARTELLA_HTML, 'script.html'), 'utf8')
  ]);
  if (!SCRIPTLET_INCLUDE.test(pagina)) throw new Error(`${nome}.html: include('script') non trovato`);

  // Funzione come sostituto: script.html contiene "$", che in una stringa
  // di sostituzione avrebbe un significato speciale.
  const html = pagina.replace(SCRIPTLET_INCLUDE, () => `<script src="/gas-shim.js"></script>\n${script}`);
  cache.set(nome, html);
  return html;
}

export async function rottePagine(app) {
  app.get('/', async (request, reply) => {
    const nome = request.query.mobile === '1' ? 'mobile' : 'desktop';
    reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-cache');
    return componiPagina(nome);
  });

  // Le pagine non dichiarano un'icona: rispondo vuoto invece di un 404.
  app.get('/favicon.ico', async (request, reply) => reply.code(204).send());

  app.get('/gas-shim.js', async (request, reply) => {
    reply.type('application/javascript; charset=utf-8');
    return readFile(path.join(CARTELLA_PUBBLICA, 'gas-shim.js'), 'utf8');
  });
}
