// ════════════════════════════════════════════════════════════════════
// Portfolio.gs — GESTIONE DEL PORTFOLIO (lettura, aggiunta, modifica,
//                eliminazione, export)
// ════════════════════════════════════════════════════════════════════
// Colonne del foglio PORTFOLIO (1-based):
//   1 portfolio_id   UUID univoco della voce
//   2 card_id        riferimento id in CACHE_CARDS
//   3 quantity       numero di copie di questa variante
//   4 condition      Near Mint / Lightly Played / …
//   5 language       ITA / ENG / JPN / …
//   6 finish         Normal / Reverse Holo / Holofoil / Special
//   7 date_added     data di aggiunta
//   8 blueprint_id   id CardTrader (per i prezzi)
//   9 last_price     ultimo prezzo noto in € (dal batch)
// ════════════════════════════════════════════════════════════════════

function convertiRigaInVocePortfolio(riga) {
  return {
    portfolio_id: String(riga[0]),
    card_id:      String(riga[1]),
    quantity:     Number(riga[2]),
    condition:    String(riga[3]),
    language:     String(riga[4]),
    finish:       String(riga[5]),
    date_added:   String(riga[6]),
    blueprint_id: riga[7] ? Number(riga[7]) : null,
    // last_price può essere 0, quindi controllo esplicito su vuoto/null
    last_price:   (riga[8] !== '' && riga[8] !== null && riga[8] !== undefined)
                    ? Number(riga[8])
                    : null
  };
}

// Cerca una voce per portfolioId nel foglio PORTFOLIO.
// Restituisce { foglio, righe, indice } dove indice è 0-based in righe
// (la riga reale nel foglio è indice+1), oppure null se non trovata.
function _trovaRigaPortfolio(portfolioId) {
  var foglio = getSheet('PORTFOLIO');
  var righe  = foglio.getDataRange().getValues();
  for (var i = 1; i < righe.length; i++) {
    if (String(righe[i][0]) === String(portfolioId)) {
      return { foglio: foglio, righe: righe, indice: i };
    }
  }
  return null;
}


// ════════════════════════════════════════════════════════════════════
// LETTURA
// ════════════════════════════════════════════════════════════════════

function getPortfolio(token) {
  return _wrapApiCall(function() {
    requireAuth(token);

    var foglio     = getSheet('PORTFOLIO');
    var ultimaRiga = foglio.getLastRow();
    if (ultimaRiga <= 1) return { success: true, items: [] };

    var righe           = foglio.getRange(1, 1, ultimaRiga, 9).getValues();
    var rigaDiPartenza  = _primaRigaDati(righe, 'portfolio_id');
    var voci = [];
    for (var i = rigaDiPartenza; i < righe.length; i++) {
      if (!righe[i][0]) continue;
      voci.push(convertiRigaInVocePortfolio(righe[i]));
    }

    return { success: true, items: voci };
  });
}


// ════════════════════════════════════════════════════════════════════
// AGGIUNTA
// ════════════════════════════════════════════════════════════════════

function addToPortfolio(token, cardId, quantity, condition, language, finish, blueprintId) {
  return _wrapApiCall(function() {
    requireAuth(token);

    if (!cardId || !quantity || !condition || !language || !finish) {
      return { success: false, error: 'Tutti i campi sono obbligatori.' };
    }

    var nuovoId = Utilities.getUuid();

    getSheet('PORTFOLIO').appendRow([
      nuovoId,
      cardId,
      quantity,
      condition,
      language,
      finish,
      formatDate(new Date()),
      blueprintId || '',
      ''
    ]);

    return { success: true, portfolio_id: nuovoId };
  });
}


// ════════════════════════════════════════════════════════════════════
// MODIFICA QUANTITÀ
// ════════════════════════════════════════════════════════════════════

function incrementPortfolioItem(token, portfolioId, delta) {
  return _wrapApiCall(function() {
    requireAuth(token);

    var trovato = _trovaRigaPortfolio(portfolioId);
    if (!trovato) return { success: false, error: 'Voce non trovata.' };

    var nuovaQuantita = parseInt(trovato.righe[trovato.indice][2], 10) + parseInt(delta, 10);
    if (nuovaQuantita <= 0) {
      return { success: false, error: 'Usa deletePortfolioItem per rimuovere la voce.' };
    }

    trovato.foglio.getRange(trovato.indice + 1, 3).setValue(nuovaQuantita);
    return { success: true, new_quantity: nuovaQuantita };
  });
}


// ════════════════════════════════════════════════════════════════════
// ELIMINAZIONE
// ════════════════════════════════════════════════════════════════════

function deletePortfolioItem(token, portfolioId) {
  return _wrapApiCall(function() {
    requireAuth(token);

    var trovato = _trovaRigaPortfolio(portfolioId);
    if (!trovato) return { success: false, error: 'Voce non trovata.' };

    trovato.foglio.deleteRow(trovato.indice + 1);
    return { success: true };
  });
}


// ════════════════════════════════════════════════════════════════════
// SALVATAGGIO PREZZO
// ════════════════════════════════════════════════════════════════════

function saveLastPrice(token, portfolioId, prezzo) {
  return _wrapApiCall(function() {
    requireAuth(token);

    var trovato = _trovaRigaPortfolio(portfolioId);
    if (!trovato) return { success: false, error: 'Voce non trovata.' };

    trovato.foglio.getRange(trovato.indice + 1, 9).setValue(prezzo !== null ? prezzo : '');
    return { success: true };
  });
}


// ════════════════════════════════════════════════════════════════════
// EXPORT CSV
// ════════════════════════════════════════════════════════════════════

function exportPortfolioData(token) {
  return _wrapApiCall(function() {
    requireAuth(token);

    var risultatoPortfolio = getPortfolio(token);
    if (!risultatoPortfolio.success) return risultatoPortfolio;
    if (risultatoPortfolio.items.length === 0) return { success: true, rows: [] };

    var righeCarte = getSheet('CACHE_CARDS').getDataRange().getValues();
    var mappaCarte = {};
    for (var i = 1; i < righeCarte.length; i++) {
      if (righeCarte[i][0]) {
        mappaCarte[righeCarte[i][0]] = {
          name:     righeCarte[i][1],
          set_name: righeCarte[i][3],
          number:   righeCarte[i][5]
        };
      }
    }

    var righeExport = risultatoPortfolio.items.map(function(voce) {
      var carta = mappaCarte[voce.card_id] || { name: voce.card_id, set_name: '', number: '' };
      return {
        nome_carta:    carta.name,
        set:           carta.set_name,
        numero:        carta.number,
        condizione:    voce.condition,
        lingua:        voce.language,
        finitura:      voce.finish,
        quantita:      voce.quantity,
        data_aggiunta: voce.date_added,
        last_price:    voce.last_price !== null ? voce.last_price : ''
      };
    });

    return { success: true, rows: righeExport };
  });
}
