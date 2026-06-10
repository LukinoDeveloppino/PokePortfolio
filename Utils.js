 // ============================================================
// Utils.gs — Funzioni di utilità generali
// ============================================================

function generateUuid() {
  return Utilities.getUuid();
}

function formatDate(date) {
  if (!date) return '';
  var d = new Date(date);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

function requireAuth(token) {
  if (!validateSession(token)) {
    throw new Error('UNAUTHORIZED');
  }
}

// Converte condizione abbreviata → nome completo CardTrader
function conditionToCardTrader(condition) {
  var map = {
    'Near Mint': 'Near Mint',
    'Lightly Played': 'Slightly Played',
    'Moderately Played': 'Moderately Played',
    'Heavily Played': 'Heavily Played',
    'Damaged': 'Poor'
  };
  return map[condition] || condition;
}

// Converte codice lingua → codice 2 lettere CardTrader
function languageToCardTrader(language) {
  var map = {
    'ITA': 'it',
    'ENG': 'en',
    'JPN': 'jp',
    'DEU': 'de',
    'FRA': 'fr',
    'ESP': 'es',
    'KOR': 'kr',
    'POR': 'pt'
  };
  return map[language] || 'en';
}
