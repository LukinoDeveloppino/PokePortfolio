// ============================================================
// Utils.gs — Funzioni di utilità generali
// ============================================================

// Genera un UUID univoco (usato per portfolio_id)
function generateUuid() {
  return Utilities.getUuid();
}

// Formatta una data in 'yyyy-MM-dd HH:mm:ss' nel fuso orario dello script
function formatDate(date) {
  if (!date) return '';
  return Utilities.formatDate(new Date(date), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

// Lancia un'eccezione UNAUTHORIZED se il token non è valido
function requireAuth(token) {
  if (!validateSession(token)) throw new Error('UNAUTHORIZED');
}
