// ════════════════════════════════════════════════════════════════════
// date.js — FORMATO DELLE DATE VERSO IL FRONTEND
// ════════════════════════════════════════════════════════════════════
// Nel database le date sono timestamptz (UTC). Verso il frontend escono
// nel formato della versione GAS, 'yyyy-MM-dd HH:mm:ss' nel fuso
// configurato, perché grafici ed etichette lo interpretano già così.
// ════════════════════════════════════════════════════════════════════

import { config } from '../config.js';

// La locale svedese produce proprio 'yyyy-MM-dd HH:mm:ss'.
const formatoDataOra = new Intl.DateTimeFormat('sv-SE', {
  timeZone: config.timeZone,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23'
});

export function formatDate(data) {
  if (!data) return '';
  return formatoDataOra.format(data instanceof Date ? data : new Date(data));
}

// Istante corrispondente a un orario "da orologio" nel fuso configurato
// (es. 2026-07-01 03:00:00 a Roma → 01:00 UTC). Serve all'import da Sheets,
// che esporta date e ore senza fuso orario.
export function istanteDaOraLocale(anno, mese, giorno, ore = 0, minuti = 0, secondi = 0) {
  const comeUtc = Date.UTC(anno, mese - 1, giorno, ore, minuti, secondi);
  // Due passaggi: il primo scostamento può cadere dall'altra parte di un
  // cambio d'ora legale.
  let istante = comeUtc - scostamentoMs(comeUtc);
  istante = comeUtc - scostamentoMs(istante);
  return new Date(istante);
}

// Differenza fra l'ora locale del fuso configurato e UTC in un istante.
function scostamentoMs(istante) {
  const [data, ora] = formatoDataOra.format(new Date(istante)).split(' ');
  const [a, me, g] = data.split('-').map(Number);
  const [h, mi, s] = ora.split(':').map(Number);
  return Date.UTC(a, me - 1, g, h, mi, s) - Math.floor(istante / 1000) * 1000;
}
