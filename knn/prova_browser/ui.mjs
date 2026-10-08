// Apre l'app locale (desktop o mobile), simula la scelta di una foto dal
// tasto 📷 della Collezione e salva uno screenshot della finestra.
//   node ui.mjs desktop|mobile <foto assoluta> <screenshot.png> <token di sessione>
// Variabili: SOLO_PANNELLO=1 (solo la sezione), CORREGGI=1 (apre l'editor
// degli angoli), TRASCINA="x1,y1>x2,y2;..." (trascina gli angoli e riconosce).
// Il token è una riga di sessions nel database LOCALE: crearla a mano e
// cancellarla alla fine. Chromium come per cdp.mjs.
import { writeFileSync } from 'node:fs';
const [,, versione, foto, uscita, token] = process.argv;
const mobile = versione === 'mobile';
const nuova = await (await fetch('http://127.0.0.1:9333/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(nuova.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const attese = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && attese.has(m.id)) { attese.get(m.id)(m.result || m.error); attese.delete(m.id); }
});
const invia = (method, params = {}) => new Promise((r) => { const i = ++id; attese.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const valuta = async (expr) => (await invia('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }))?.result?.value;
const attendi = (ms) => new Promise((r) => setTimeout(r, ms));

if (mobile) {
  await invia('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
} else {
  await invia('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
}
const url = `http://127.0.0.1:3000/?mobile=${mobile ? 1 : 0}`;
await invia('Page.navigate', { url });
await attendi(1500);
await valuta(`sessionStorage.setItem('pf_token', ${JSON.stringify(token)}); sessionStorage.setItem('pf_username', 'prova'); true`);
await invia('Page.navigate', { url });
await attendi(3000);
await valuta(`navigateTo('collezione'); true`);
await attendi(2500);
if (process.env.SOLO_PANNELLO) {
  const shot = await invia('Page.captureScreenshot', { format: 'png' });
  writeFileSync(uscita, Buffer.from(shot.data, 'base64'));
  process.exit(0);
}
const { root } = await invia('DOM.getDocument');
const { nodeId } = await invia('DOM.querySelector', { nodeId: root.nodeId, selector: '#collezione-foto' });
await invia('DOM.setFileInputFiles', { nodeId, files: [foto] });
for (let i = 0; i < 90; i++) {
  await attendi(1000);
  const pronto = await valuta(`!!document.querySelector('#tcg-scan-contenuto .tcg-scan-actions')`);
  if (pronto) break;
}
await attendi(1500);   // immagini dei candidati
if (process.env.CORREGGI) {
  writeFileSync(uscita.replace('.png', '-risultato.png'), Buffer.from((await invia('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await valuta(`document.querySelector('[data-scan=correggi]').click(); true`);
  await attendi(800);
}
if (process.env.TRASCINA) {
  // "x1,y1>x2,y2;..." in pixel CSS: trascina ogni angolo, poi Riconosci.
  for (const tratto of process.env.TRASCINA.split(';')) {
    const [[x1, y1], [x2, y2]] = tratto.split('>').map((p) => p.split(',').map(Number));
    await invia('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 8; i++) {
      await invia('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1 + (x2 - x1) * i / 8, y: y1 + (y2 - y1) * i / 8, button: 'left', buttons: 1 });
    }
    await invia('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', buttons: 0, clickCount: 1 });
  }
  writeFileSync(uscita.replace('.png', '-trascinato.png'), Buffer.from((await invia('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await valuta(`document.querySelector('[data-scan=riconosci-correzione]').click(); true`);
  for (let i = 0; i < 30; i++) {
    await attendi(500);
    if (await valuta(`!!document.querySelector('#tcg-scan-contenuto .tcg-scan-actions [data-scan=altra]')`)) break;
  }
  await attendi(1200);
}
console.log(await valuta(`document.querySelector('#tcg-scan-contenuto').innerText.slice(0, 300)`));
const shot = await invia('Page.captureScreenshot', { format: 'png' });
writeFileSync(uscita, Buffer.from(shot.data, 'base64'));
process.exit(0);
