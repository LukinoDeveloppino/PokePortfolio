// ════════════════════════════════════════════════════════════════════
// scheduler.js — JOB PERIODICI
// ════════════════════════════════════════════════════════════════════
// Sostituisce i trigger giornalieri creati da Setup.gs:
//   03:00 e 15:00 aggiornamento dei prezzi di tutti gli utenti
//   05:00 sync del catalogo (solo set nuovi)
//
// Due modi per farli partire, anche insieme:
//   • scheduler interno (SCHEDULER=true, predefinito): va bene quando il
//     processo resta sempre acceso (PC locale, PaaS a pagamento);
//   • POST /api/cron/<job> con header Authorization: Bearer <CRON_SECRET>,
//     per i PaaS che addormentano l'app: lo chiama un cron esterno.
// L'indice unico su job_runs impedisce comunque due giri sovrapposti.
// ════════════════════════════════════════════════════════════════════

import { Cron } from 'croner';
import { timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { avviaSyncCatalogo } from '../services/catalog.js';
import { avviaAggiornamentoPrezzi } from '../services/prices.js';

export const JOB = {
  prices:         (log) => avviaAggiornamentoPrezzi({ log }),
  'catalog-sync': (log) => avviaSyncCatalogo({ mode: 'sync', log })
};

const PIANIFICAZIONE = {
  prices:         '0 3,15 * * *',
  'catalog-sync': '0 5 * * *'
};

export function avviaScheduler(log) {
  const pianificati = Object.entries(PIANIFICAZIONE).map(([nome, espressione]) =>
    new Cron(espressione, { timezone: config.timeZone, name: nome, protect: true }, async () => {
      const { avviato } = await JOB[nome](log);
      if (!avviato) log.info(`[CRON] ${nome}: già in corso, salto.`);
    })
  );
  log.info(`[CRON] Job pianificati (${config.timeZone}): ` +
           Object.entries(PIANIFICAZIONE).map(([n, e]) => `${n} "${e}"`).join(', '));
  return () => pianificati.forEach((job) => job.stop());
}

function segretoValido(intestazione) {
  if (!config.cronSecret) return false;
  const atteso = Buffer.from('Bearer ' + config.cronSecret);
  const ricevuto = Buffer.from(String(intestazione || ''));
  return atteso.length === ricevuto.length && timingSafeEqual(atteso, ricevuto);
}

export async function rotteCron(app) {
  app.post('/api/cron/:job', async (request, reply) => {
    if (!segretoValido(request.headers.authorization)) {
      return reply.code(401).send({ success: false, error: 'UNAUTHORIZED' });
    }
    const job = Object.hasOwn(JOB, request.params.job) ? JOB[request.params.job] : null;
    if (!job) return reply.code(404).send({ success: false, error: 'Job sconosciuto.' });

    const { avviato } = await job(app.log);
    return reply.code(avviato ? 202 : 409).send({ success: avviato, started: avviato });
  });
}
