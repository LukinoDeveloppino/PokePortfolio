// ════════════════════════════════════════════════════════════════════
// config.js — CONFIGURAZIONE DA VARIABILI D'AMBIENTE
// ════════════════════════════════════════════════════════════════════
// Tutta la configurazione passa dall'ambiente, così lo stesso codice gira
// in locale (file .env) e su un PaaS (variabili impostate dal pannello).
// ════════════════════════════════════════════════════════════════════

function obbligatoria(nome) {
  const valore = process.env[nome];
  if (!valore) throw new Error(`Variabile d'ambiente mancante: ${nome} (vedi .env.example)`);
  return valore;
}

export const config = {
  port:        Number(process.env.PORT || 3000),
  host:        process.env.HOST || '0.0.0.0',
  databaseUrl: obbligatoria('DATABASE_URL'),
  databaseSsl: process.env.DATABASE_SSL === 'true',
  timeZone:    process.env.TZ || 'Europe/Rome',
  cardTraderDefaultToken: process.env.CARDTRADER_DEFAULT_TOKEN || '',
  // Scheduler interno dei job notturni (vedi jobs/scheduler.js).
  scheduler:   process.env.SCHEDULER !== 'false',
  // Tentativi di login e di registrazione al minuto per ogni IP.
  limiteAccessiAlMinuto: Number(process.env.LIMITE_ACCESSI_AL_MINUTO || 10),
  // Segreto per POST /api/cron/<job>; vuoto = endpoint disabilitato.
  cronSecret:  process.env.CRON_SECRET || ''
};
