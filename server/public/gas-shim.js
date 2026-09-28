// ════════════════════════════════════════════════════════════════════
// gas-shim.js — google.script.run SOPRA fetch
// ════════════════════════════════════════════════════════════════════
// Il frontend è nato per Google Apps Script e chiama il backend così:
//
//   google.script.run
//     .withSuccessHandler(fn)
//     .withFailureHandler(fn)
//     .nomeFunzione(arg1, arg2, ...);
//
// Questo file ricrea la stessa interfaccia: ogni chiamata diventa
// POST /api/rpc/nomeFunzione con gli argomenti come array JSON. In questo
// modo script.html funziona senza modifiche.
// ════════════════════════════════════════════════════════════════════

(function () {
  function chiamaServer(nomeFunzione, argomenti, successo, fallimento) {
    fetch('/api/rpc/' + encodeURIComponent(nomeFunzione), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      // Come google.script.run, undefined diventa null.
      body:    JSON.stringify(Array.prototype.slice.call(argomenti))
    })
      .then(function (risposta) {
        if (!risposta.ok) throw new Error('Errore del server (HTTP ' + risposta.status + ')');
        return risposta.json();
      })
      .then(
        function (dati) { if (successo) successo(dati); },
        function (errore) {
          if (fallimento) fallimento(errore);
          else console.error('[' + nomeFunzione + ']', errore);
        }
      );
  }

  // Ogni with*Handler restituisce un NUOVO runner, come in Apps Script:
  // così `var chiamata = google.script.run.withSuccessHandler(f)` si può
  // riusare senza che i gestori di chiamate diverse si mescolino.
  function creaRunner(successo, fallimento) {
    return new Proxy({}, {
      get: function (_, nome) {
        if (nome === 'withSuccessHandler') return function (fn) { return creaRunner(fn, fallimento); };
        if (nome === 'withFailureHandler') return function (fn) { return creaRunner(successo, fn); };
        if (nome === 'withUserObject')     return function () { return creaRunner(successo, fallimento); };
        if (typeof nome !== 'string' || nome === 'then') return undefined;
        return function () { chiamaServer(nome, arguments, successo, fallimento); };
      }
    });
  }

  window.google = window.google || {};
  window.google.script = { run: creaRunner(null, null) };
})();
