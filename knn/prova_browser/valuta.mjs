// Impronte dei ritagli calcolate dal browser (vedi prepara.py e cdp.mjs)
// → riconosciCarta sul database locale, per tipo di scena.
//   node --env-file=.env knn/prova_browser/valuta.mjs
import { readFileSync } from 'node:fs';
import { pool } from '../../server/src/db/pool.js';
import { riconosciCarta } from '../../server/src/services/riconoscimento.js';

const { ms, risultati } = JSON.parse(readFileSync(new URL('../dataset/prova_browser/risultato.txt', import.meta.url), 'utf8').slice(5));
const ids = risultati.map((r) => r.nome.split('__')[1]);
const { rows } = await pool.query('SELECT id, game_key FROM tcg_cards WHERE id = ANY($1)', [ids]);
const chiave = new Map(rows.map((r) => [r.id, r.game_key]));
const perTipo = {};
let ritagli = 0;
for (const r of risultati) {
  const [tipo, id] = r.nome.split('__');
  const res = await riconosciCarta(0, r.impronte);
  perTipo[tipo] ??= { giuste: 0, primi5: 0, n: 0 };
  perTipo[tipo].n++;
  perTipo[tipo].giuste += res.candidates[0].game_key === chiave.get(id);
  perTipo[tipo].primi5 += res.candidates.some((c) => c.game_key === chiave.get(id));
  ritagli += r.impronte.length / 2;
}
let g = 0, p5 = 0, n = 0;
for (const [tipo, v] of Object.entries(perTipo)) {
  console.log(`${tipo.padEnd(13)} ${Math.round(100 * v.giuste / v.n)}%  (primi 5: ${Math.round(100 * v.primi5 / v.n)}%)`);
  g += v.giuste; p5 += v.primi5; n += v.n;
}
console.log(`TOTALE        ${Math.round(100 * g / n)}%  (primi 5: ${Math.round(100 * p5 / n)}%), ${(ritagli / n).toFixed(1)} ritagli a foto, ${Math.round(ms)} ms a foto nel browser`);
await pool.end();
