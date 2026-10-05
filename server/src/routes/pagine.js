// ════════════════════════════════════════════════════════════════════
// pagine.js — PAGINE HTML DEL FRONTEND
// ════════════════════════════════════════════════════════════════════
// Serve HTML/desktop.html e HTML/mobile.html (smartphone) così come sono
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

// Su Apps Script la versione mobile si apriva solo con ?mobile=1; qui la
// sceglie da sola in base allo smartphone. ?mobile=1 e ?mobile=0 forzano
// una delle due. I tablet (niente "Mobi" nello user agent) restano desktop.
const SMARTPHONE = /Mobi|iPhone|iPod/i;

export function versioneRichiesta(request) {
  if (request.query.mobile === '1') return 'mobile';
  if (request.query.mobile === '0') return 'desktop';
  return SMARTPHONE.test(request.headers['user-agent'] || '') ? 'mobile' : 'desktop';
}

export async function rottePagine(app) {
  app.get('/', async (request, reply) => {
    const nome = versioneRichiesta(request) === 'mobile' ? 'mobile' : 'desktop';
    reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-cache').header('Vary', 'User-Agent');
    return componiPagina(nome);
  });

  // Le pagine dichiarano /favicon.svg; /favicon.ico resta per i client
  // che lo chiedono comunque: rispondo vuoto invece di un 404.
  app.get('/favicon.ico', async (request, reply) => reply.code(204).send());

  app.get('/favicon.svg', async (request, reply) => {
    reply.type('image/svg+xml').header('Cache-Control', 'public, max-age=86400');
    return readFile(path.join(CARTELLA_PUBBLICA, 'favicon.svg'), 'utf8');
  });

  app.get('/gas-shim.js', async (request, reply) => {
    reply.type('application/javascript; charset=utf-8');
    return readFile(path.join(CARTELLA_PUBBLICA, 'gas-shim.js'), 'utf8');
  });
}
