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
