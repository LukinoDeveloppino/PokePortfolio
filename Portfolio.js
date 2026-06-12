// ════════════════════════════════════════════════════════════════════
// Portfolio.gs — GESTIONE DEL PORTFOLIO (lettura, aggiunta, modifica,
//                eliminazione, export)
// ════════════════════════════════════════════════════════════════════
// Il foglio PORTFOLIO ha una riga per ogni VARIANTE posseduta.
// La stessa carta può quindi avere più righe (es. una copia Near Mint
// inglese e una Lightly Played italiana).
//
// Colonne del foglio (1-based):
//   1 portfolio_id  → UUID univoco della voce
//   2 card_id       → riferimento all'id della carta in CACHE_CARDS
//   3 quantity      → numero di copie di questa variante
//   4 condition     → Near Mint / Lightly Played / ...
//   5 language      → ITA / ENG / JPN / ...
//   6 finish        → Normal / Reverse Holo / Holofoil / Special
//   7 date_added    → data di aggiunta
//   8 blueprint_id  → id CardTrader (serve per cercare i prezzi)
//   9 last_price    → ultimo prezzo noto in € (aggiornato dal batch prezzi)
// ════════════════════════════════════════════════════════════════════


/**
 * Converte una riga "grezza" del foglio PORTFOLIO in un oggetto con campi
 * nominati. Usata sia qui che in Friends.gs (il portfolio di un amico ha
 * la stessa identica struttura).
 *
 * @param {Array} riga - array di 9 celle nell'ordine delle colonne sopra
 */
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
    // last_price può legittimamente essere 0, quindi controlliamo
    // esplicitamente vuoto/null/undefined invece di usare un semplice if.
    last_price:   (riga[8] !== '' && riga[8] !== null && riga[8] !== undefined)
                    ? Number(riga[8])
                    : null
  };
}


// ════════════════════════════════════════════════════════════════════
// LETTURA
// ════════════════════════════════════════════════════════════════════

/**
 * Restituisce TUTTE le voci del portfolio dell'utente loggato.
 */
function getPortfolio(token) {
  try {
    requireAuth(token);

    var foglio     = getSheet('PORTFOLIO');
    var ultimaRiga = foglio.getLastRow();
    if (ultimaRiga <= 1) return { success: true, items: [] };

    var righe = foglio.getRange(1, 1, ultimaRiga, 9).getValues();

    // Se la prima riga è l'intestazione ('portfolio_id'), parti dalla seconda.
    var rigaDiPartenza = (righe[0][0] === 'portfolio_id') ? 1 : 0;

    var voci = [];
    for (var i = rigaDiPartenza; i < righe.length; i++) {
      if (!righe[i][0]) continue; // salta righe vuote
      voci.push(convertiRigaInVocePortfolio(righe[i]));
    }

    return { success: true, items: voci };
  } catch (errore) {
    if (errore.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: errore.message };
  }
}


// ════════════════════════════════════════════════════════════════════
// AGGIUNTA
// ════════════════════════════════════════════════════════════════════

/**
 * Aggiunge una nuova variante al portfolio.
 * Chiamata dal form "Aggiungi al portfolio" nel modal della carta.
 *
 * @returns {{success:boolean, portfolio_id?:string, error?:string}}
 */
function addToPortfolio(token, cardId, quantity, condition, language, finish, blueprintId) {
  try {
    requireAuth(token);

    if (!cardId || !quantity || !condition || !language || !finish) {
      return { success: false, error: 'Tutti i campi sono obbligatori.' };
    }

    var nuovoId = generateUuid();

    getSheet('PORTFOLIO').appendRow([
      nuovoId,                 // portfolio_id
      cardId,                  // card_id
      quantity,                // quantity
      condition,               // condition
      language,                // language
      finish,                  // finish
      formatDate(new Date()),  // date_added
      blueprintId || '',       // blueprint_id
      ''                       // last_price (verrà popolato dal batch prezzi)
    ]);

    return { success: true, portfolio_id: nuovoId };
  } catch (errore) {
    if (errore.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: errore.message };
  }
}


// ════════════════════════════════════════════════════════════════════
// MODIFICA QUANTITÀ
// ════════════════════════════════════════════════════════════════════

/**
 * Incrementa (delta positivo) o decrementa (delta negativo) la quantità
 * di una voce. Chiamata dai pulsanti + e − nel modal della carta.
 *
 * Se la nuova quantità scenderebbe a 0 o meno restituisce errore:
 * in quel caso il frontend chiede conferma e usa deletePortfolioItem.
 */
function incrementPortfolioItem(token, portfolioId, delta) {
  try {
    requireAuth(token);

    var foglio = getSheet('PORTFOLIO');
    var righe  = foglio.getDataRange().getValues();

    for (var i = 1; i < righe.length; i++) { // i=1 salta l'intestazione
      if (righe[i][0] === portfolioId) {
        var nuovaQuantita = parseInt(righe[i][2], 10) + parseInt(delta, 10);
        if (nuovaQuantita <= 0) {
          return { success: false, error: 'Usa deletePortfolioItem per rimuovere la voce.' };
        }
        foglio.getRange(i + 1, 3).setValue(nuovaQuantita); // colonna 3 = quantity
        return { success: true, new_quantity: nuovaQuantita };
      }
    }

    return { success: false, error: 'Voce non trovata.' };
  } catch (errore) {
    if (errore.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: errore.message };
  }
}


// ════════════════════════════════════════════════════════════════════
// ELIMINAZIONE
// ════════════════════════════════════════════════════════════════════

/**
 * Elimina definitivamente una voce dal portfolio (l'intera riga).
 * Il frontend mostra sempre una conferma "Sei sicuro?" prima di chiamarla.
 */
function deletePortfolioItem(token, portfolioId) {
  try {
    requireAuth(token);

    var foglio = getSheet('PORTFOLIO');
    var righe  = foglio.getDataRange().getValues();

    for (var i = 1; i < righe.length; i++) {
      if (righe[i][0] === portfolioId) {
        foglio.deleteRow(i + 1); // +1: getValues è 0-based, le righe del foglio 1-based
        return { success: true };
      }
    }

    return { success: false, error: 'Voce non trovata.' };
  } catch (errore) {
    if (errore.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: errore.message };
  }
}


// ════════════════════════════════════════════════════════════════════
// SALVATAGGIO PREZZO
// ════════════════════════════════════════════════════════════════════

/**
 * Salva l'ultimo prezzo noto (colonna 9, last_price) per una singola voce.
 */
function saveLastPrice(token, portfolioId, prezzo) {
  try {
    requireAuth(token);

    var foglio = getSheet('PORTFOLIO');
    var righe  = foglio.getDataRange().getValues();

    for (var i = 1; i < righe.length; i++) {
      if (String(righe[i][0]) === String(portfolioId)) {
        foglio.getRange(i + 1, 9).setValue(prezzo !== null ? prezzo : '');
        return { success: true };
      }
    }

    return { success: false, error: 'Voce non trovata.' };
  } catch (errore) {
    if (errore.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: errore.message };
  }
}


// ════════════════════════════════════════════════════════════════════
// EXPORT CSV
// ════════════════════════════════════════════════════════════════════

/**
 * Prepara i dati per l'export CSV del portfolio.
 * Restituisce le righe già "arricchite" con nome carta, set e numero
 * (presi da CACHE_CARDS); il file CSV vero e proprio viene poi costruito
 * e scaricato dal frontend.
 */
function exportPortfolioData(token) {
  try {
    requireAuth(token);

    var risultatoPortfolio = getPortfolio(token);
    if (!risultatoPortfolio.success) return risultatoPortfolio;
    if (risultatoPortfolio.items.length === 0) return { success: true, rows: [] };

    // ---- Costruisci una mappa card_id → {nome, set, numero} dalla cache ----
    var righeCarte = getSheet('CACHE_CARDS').getDataRange().getValues();
    var mappaCarte = {};
    for (var i = 1; i < righeCarte.length; i++) {
      var riga = righeCarte[i];
      if (riga[0]) {
        mappaCarte[riga[0]] = {
          name:     riga[1], // nome carta
          set_name: riga[3], // nome set
          number:   riga[5]  // numero nel set
        };
      }
    }

    // ---- Componi le righe di export ----
    var righeExport = risultatoPortfolio.items.map(function(voce) {
      // Se per qualche motivo la carta non è in cache, usa il card_id come nome.
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
  } catch (errore) {
    if (errore.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: errore.message };
  }
}
