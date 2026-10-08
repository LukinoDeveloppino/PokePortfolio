// Apre la pagina di prova in Chromium e aspetta il risultato (tempo reale:
// con --virtual-time-budget OpenCV.js non fa in tempo ad avviarsi).
// Prima: chromium --headless=new --remote-debugging-port=9333 --user-data-dir=<cartella> about:blank
//   node cdp.mjs http://127.0.0.1:8765/index.html <file risultato>
const [,, url, uscita] = process.argv;
const nuova = await (await fetch('http://127.0.0.1:9333/json/new?' + url, { method: 'PUT' })).json();
const ws = new WebSocket(nuova.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const attese = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && attese.has(m.id)) { attese.get(m.id)(m.result); attese.delete(m.id); }
});
const invia = (method, params) => new Promise((r) => { const i = ++id; attese.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const inizio = Date.now();
while (Date.now() - inizio < 800000) {
  await new Promise((r) => setTimeout(r, 2000));
  const r = await invia('Runtime.evaluate', { expression: "document.getElementById('out') ? document.getElementById('out').textContent : ''", returnByValue: true });
  const testo = r?.result?.value || '';
  if (testo.startsWith('FATTO') || testo.startsWith('ERRORE')) {
    (await import('node:fs')).writeFileSync(uscita, testo);
    console.log(testo.slice(0, 80), `(${Math.round((Date.now() - inizio) / 1000)} s)`);
    process.exit(0);
  }
}
console.log('timeout'); process.exit(1);
