// ════════════════════════════════════════════════════════════════════
// Utils.gs — FUNZIONI DI UTILITÀ GENERALI
// ════════════════════════════════════════════════════════════════════
// Piccole funzioni di supporto usate da tutti gli altri file backend.
// ════════════════════════════════════════════════════════════════════

/**
 * Genera un UUID univoco (es. "a1b2c3d4-...").
 * Usato come portfolio_id quando si aggiunge una nuova voce al portfolio.
 */
function generateUuid() {
  return Utilities.getUuid();
}

/**
 * Formatta una data nel formato 'yyyy-MM-dd HH:mm:ss' usando il fuso orario
 * configurato nel progetto Apps Script.
 * Restituisce stringa vuota se la data non è valida/assente.
 */
function formatDate(data) {
  if (!data) return '';
  return Utilities.formatDate(
    new Date(data),
    Session.getScriptTimeZone(),
    'yyyy-MM-dd HH:mm:ss'
  );
}

/**
 * Controllo di autenticazione: lancia un'eccezione con messaggio
 * 'UNAUTHORIZED' se il token di sessione non è valido o è scaduto.
 *
 * Va chiamata all'inizio di OGNI funzione backend esposta al frontend.
 * I blocchi catch delle funzioni chiamanti intercettano il messaggio
 * 'UNAUTHORIZED' e lo restituiscono al frontend, che a quel punto
 * riporta l'utente alla pagina di login.
 */
function requireAuth(token) {
  if (!validateSession(token)) throw new Error('UNAUTHORIZED');
}
