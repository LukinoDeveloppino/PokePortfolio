// ════════════════════════════════════════════════════════════════════
// jobs.js — REGISTRO DELLE ESECUZIONI DEI JOB (tabella job_runs)
// ════════════════════════════════════════════════════════════════════
// Sostituisce i semafori catalog_running / running di BATCH_STATE e il
// LockService: l'indice unico parziale su job_runs garantisce che per
// ogni tipo di job ci sia al massimo un'esecuzione 'running', anche con
// più istanze del server.
// ════════════════════════════════════════════════════════════════════

import { pool } from '../db/pool.js';

const VIOLAZIONE_UNICITA = '23505';

// Registra l'inizio di un job. Restituisce l'id dell'esecuzione, oppure
// null se ce n'è già una in corso dello stesso tipo.
export async function iniziaJob(job, mode = null) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO job_runs (job, mode, status) VALUES ($1, $2, 'running') RETURNING id`,
      [job, mode]
    );
    return rows[0].id;
  } catch (errore) {
    if (errore.code === VIOLAZIONE_UNICITA) return null;
    throw errore;
  }
}

export async function aggiornaContatoreJob(idEsecuzione, contatore) {
  await pool.query('UPDATE job_runs SET changed_count = $2 WHERE id = $1', [idEsecuzione, contatore]);
}

export async function terminaJob(idEsecuzione, { errore = null, contatore } = {}) {
  await pool.query(
    `UPDATE job_runs
        SET status = $2, finished_at = now(), error = $3,
            changed_count = COALESCE($4, changed_count)
      WHERE id = $1`,
    [idEsecuzione, errore ? 'failed' : 'done', errore, contatore ?? null]
  );
}

// Un'esecuzione resta 'running' se il processo è stato fermato a metà
// (deploy, crash). All'avvio del server la chiudo come fallita, altrimenti
// l'indice unico bloccherebbe per sempre le esecuzioni successive.
export async function chiudiJobInterrotti() {
  const { rowCount } = await pool.query(
    `UPDATE job_runs SET status = 'failed', finished_at = now(),
            error = 'Interrotto dal riavvio del server'
      WHERE status = 'running'`
  );
  return rowCount;
}

// Stato sintetico di un tipo di job per il frontend.
export async function statoJob(job) {
  const { rows } = await pool.query(
    `SELECT
       (SELECT row_to_json(r) FROM (
          SELECT mode, changed_count FROM job_runs
           WHERE job = $1 AND status = 'running' LIMIT 1) r)                  AS in_corso,
       (SELECT max(finished_at) FROM job_runs WHERE job = $1 AND status = 'done') AS ultimo_completato,
       (SELECT changed_count FROM job_runs
         WHERE job = $1 AND mode = 'refresh' ORDER BY started_at DESC LIMIT 1)  AS ultimo_refresh_cambiati`,
    [job]
  );
  const riga = rows[0];
  return {
    running:          !!riga.in_corso,
    mode:             riga.in_corso ? riga.in_corso.mode || '' : '',
    lastDone:         riga.ultimo_completato,
    refreshChanged:   riga.in_corso ? riga.in_corso.changed_count : (riga.ultimo_refresh_cambiati || 0)
  };
}
