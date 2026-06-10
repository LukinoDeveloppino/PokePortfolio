 // ============================================================
// Auth.gs — Login e gestione sessioni via PropertiesService
// ============================================================

function login(password) {
  try {
    var storedPassword = getConfig('password');
    if (!storedPassword) {
      return { success: false, error: 'Password non configurata nel foglio CONFIG.' };
    }
    if (password !== storedPassword) {
      return { success: false, error: 'Password errata.' };
    }

    var sessionToken = Utilities.getUuid();
    var expiresAt = new Date().getTime() + (24 * 60 * 60 * 1000); // 24 ore

    var props = PropertiesService.getUserProperties();
    props.setProperty('session_token', sessionToken);
    props.setProperty('session_expires', String(expiresAt));

    return { success: true, token: sessionToken };
  } catch (e) {
    return { success: false, error: 'Errore durante il login: ' + e.message };
  }
}

function validateSession(token) {
  try {
    if (!token) return false;
    var props = PropertiesService.getUserProperties();
    var storedToken = props.getProperty('session_token');
    var expiresAt = parseInt(props.getProperty('session_expires') || '0', 10);

    if (token !== storedToken) return false;
    if (new Date().getTime() > expiresAt) {
      props.deleteProperty('session_token');
      props.deleteProperty('session_expires');
      return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}

function logout(token) {
  try {
    var props = PropertiesService.getUserProperties();
    props.deleteProperty('session_token');
    props.deleteProperty('session_expires');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function checkSession(token) {
  return { valid: validateSession(token) };
}
