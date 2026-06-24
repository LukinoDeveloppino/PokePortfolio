// ════════════════════════════════════════════════════════════════════
// Prices.gs — PREZZI DA CARDTRADER + DASHBOARD + BATCH NOTTURNO
// ════════════════════════════════════════════════════════════════════
// Questo file gestisce:
//   1. La ricerca del PREZZO MINIMO su CardTrader per una variante
//      (carta + condizione + lingua + finitura).
//   2. La chiamata real-time dal frontend quando si apre il modal carta.
//   3. Il TRIGGER BATCH (updateAllUsersAllPrices) che, agganciato a un
//      time-based trigger di Apps Script, aggiorna periodicamente i
//      prezzi di TUTTI gli utenti e salva lo storico per il grafico.
//      Il batch è MULTI-HOP: si spezza in più esecuzioni per non superare
//      il limite di 6 minuti di Apps Script (vedi sezione dedicata).
//   4. I dati per la dashboard (valore totale, n. carte, n. set).
//
// Nota: l'URL base dell'API (URL_BASE_API_CARDTRADER) è definito in Cards.gs.
// Le credenziali NON sono mai esposte al frontend: tutte le chiamate
// avvengono server-side.
// ════════════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════════════
// CONVERSIONI: i nostri valori → i codici usati da CardTrader
// ════════════════════════════════════════════════════════════════════

/**
 * Converte la condizione usata nell'app nel nome usato da CardTrader.
 * (es. 'Lightly Played' da noi si chiama 'Slightly Played' su CardTrader)
 */
function convertiCondizionePerCardTrader(condizione) {
  var mappa = {
    'Near Mint':         'Near Mint',
    'Lightly Played':    'Slightly Played',
    'Moderately Played': 'Moderately Played',
    'Heavily Played':    'Heavily Played',
    'Damaged':           'Poor'
  };
  return mappa[condizione] || condizione;
}

/**
 * Converte il codice lingua a 3 lettere usato nell'app nel codice a 2
 * lettere usato da CardTrader. Default: inglese.
 */
function convertiLinguaPerCardTrader(lingua) {
  var mappa = {
    'ITA': 'it', 'ENG': 'en', 'JPN': 'jp', 'DEU': 'de',
    'FRA': 'fr', 'ESP': 'es', 'KOR': 'kr', 'POR': 'pt'
  };
  return mappa[lingua] || 'en';
}


// ════════════════════════════════════════════════════════════════════
// RECUPERO DEL blueprint_id
// ════════════════════════════════════════════════════════════════════
// Il blueprint_id è l'identificativo CardTrader della carta: serve per
// interrogare il marketplace. Normalmente è già salvato nella riga del
// portfolio o nella cache carte; queste funzioni lo cercano se manca.
// ════════════════════════════════════════════════════════════════════

/**
 * Recupera il blueprint_id di una carta dalla CACHE_CARDS dell'utente
 * loggato. Se il valore è già noto (passato come parametro) lo restituisce
 * direttamente senza leggere il foglio.
 */
function getBlueprintIdForCard(cardId, blueprintIdGiaNoto) {
  if (blueprintIdGiaNoto) return Number(blueprintIdGiaNoto);

  var foglio     = getSheet('CACHE_CARDS');
  var ultimaRiga = foglio.getLastRow();
  if (ultimaRiga <= 1) return null;

  var righe = foglio.getRange(1, 1, ultimaRiga, 13).getValues();
  for (var i = 1; i < righe.length; i++) {
    if (String(righe[i][0]) === String(cardId)) {
      return righe[i][12] ? Number(righe[i][12]) : null; // colonna 13 = blueprint_id
    }
  }
  return null;
}

/**
 * Come getBlueprintIdForCard, ma cerca in uno spreadsheet ARBITRARIO
 * (passato come oggetto). Usata dal batch multi-utente, che lavora sugli
 * sheet di tutti gli utenti senza una sessione attiva.
 */
function getBlueprintIdFromSheet(spreadsheet, cardId, blueprintIdGiaNoto) {
  if (blueprintIdGiaNoto) return Number(blueprintIdGiaNoto);

  try {
    var foglio = spreadsheet.getSheetByName('CACHE_CARDS');
    if (!foglio) return null;

    var ultimaRiga = foglio.getLastRow();
    if (ultimaRiga <= 1) return null;

    var righe = foglio.getRange(1, 1, ultimaRiga, 13).getValues();
    for (var i = 1; i < righe.length; i++) {
      if (String(righe[i][0]) === String(cardId)) {
        return righe[i][12] ? Number(righe[i][12]) : null;
      }
    }
  } catch (errore) {
    Logger.log('[PRICES] getBlueprintIdFromSheet error: ' + errore.message);
  }
  return null;
}


// ════════════════════════════════════════════════════════════════════
// CORE: PREZZO MINIMO DA CARDTRADER PER UNA VARIANTE
// ════════════════════════════════════════════════════════════════════

/**
 * Interroga il marketplace CardTrader e restituisce il prezzo MINIMO
 * disponibile per una variante (carta + condizione + lingua + finitura).
 *
 * La apiKey viene passata esplicitamente perché ogni utente ha la propria
 * chiave (questa funzione è usata sia dalla sessione corrente che dal batch).
 *
 * Logica di filtro dei prodotti in vendita:
 *   1. esclude i venditori "in vacanza"
 *   2. tiene solo i prodotti con la condizione richiesta
 *   3. se NESSUN prodotto ha quella condizione, accetta qualsiasi
 *      condizione (meglio un prezzo indicativo che nessun prezzo)
 *
 * @returns {{success:boolean, price:number|null, currency?:string, message:string|null}}
 *   price = prezzo in € (null se non disponibile)
 */
function _fetchPriceFromCardTrader(cardId, condizione, lingua, finitura, blueprintId, apiKey) {
  if (!apiKey) return { success: false, price: null, message: 'API key mancante.' };

  var idBlueprint = blueprintId ? Number(blueprintId) : null;
  if (!idBlueprint) {
    Logger.log('[PRICES] Nessun blueprint_id per ' + cardId);
    return { success: true, price: null, message: 'Prezzo non disponibile' };
  }

  Logger.log('[PRICES] blueprint_id=' + idBlueprint + ' | ' + condizione + ' | ' + lingua);

  // ---- Componi l'URL della ricerca sul marketplace ----
  var linguaCardTrader = convertiLinguaPerCardTrader(lingua);
  var url = URL_BASE_API_CARDTRADER + '/marketplace/products' +
            '?blueprint_id=' + idBlueprint +
            '&language=' + linguaCardTrader;

  // Le finiture lucide vengono cercate come "foil" su CardTrader.
  if (finitura === 'Holofoil' || finitura === 'Special') url += '&foil=true';

  // ---- Chiamata HTTP ----
  var risposta = UrlFetchApp.fetch(url, {
    headers: { 'Authorization': 'Bearer ' + apiKey },
    muteHttpExceptions: true
  });

  var codiceHttp = risposta.getResponseCode();
  Logger.log('[PRICES] HTTP ' + codiceHttp + ' → ' + url);

  if (codiceHttp !== 200) {
    return { success: false, price: null, message: 'Servizio non disponibile.' };
  }

  // La risposta è { "<blueprint_id>": [prodotto, prodotto, ...] }
  var prodottiInVendita = (JSON.parse(risposta.getContentText()))[String(idBlueprint)] || [];
  Logger.log('[PRICES] Prodotti trovati: ' + prodottiInVendita.length);

  if (prodottiInVendita.length === 0) {
    return { success: true, price: null, message: 'Prezzo non disponibile' };
  }

  // ---- Filtro per condizione (con fallback a "qualsiasi condizione") ----
  var condizioneCardTrader = convertiCondizionePerCardTrader(condizione);

  var prodottiFiltrati = prodottiInVendita.filter(function(prodotto) {
    return !prodotto.on_vacation &&
           (!prodotto.properties_hash ||
            !prodotto.properties_hash.condition ||
            prodotto.properties_hash.condition === condizioneCardTrader);
  });

  // Nessun prodotto con quella condizione? Accetta qualsiasi condizione
  // (continuando comunque a escludere i venditori in vacanza).
  if (prodottiFiltrati.length === 0) {
    prodottiFiltrati = prodottiInVendita.filter(function(prodotto) {
      return !prodotto.on_vacation;
    });
  }
  if (prodottiFiltrati.length === 0) {
    return { success: true, price: null, message: 'Prezzo non disponibile' };
  }

  // ---- Trova il prezzo minimo (i prezzi sono in centesimi) ----
  var prezzoMinimoInCentesimi = null;
  var valuta = 'EUR';

  prodottiFiltrati.forEach(function(prodotto) {
    if (prodotto.price && typeof prodotto.price.cents === 'number') {
      if (prezzoMinimoInCentesimi === null || prodotto.price.cents < prezzoMinimoInCentesimi) {
        prezzoMinimoInCentesimi = prodotto.price.cents;
        valuta = prodotto.price.currency || 'EUR';
      }
    }
  });

  if (prezzoMinimoInCentesimi === null) {
    return { success: true, price: null, message: 'Prezzo non disponibile' };
  }

  var prezzoInEuro = parseFloat((prezzoMinimoInCentesimi / 100).toFixed(2));
  Logger.log('[PRICES] Prezzo: ' + prezzoInEuro + ' ' + valuta);

  return { success: true, price: prezzoInEuro, currency: valuta, message: null };
}


// ════════════════════════════════════════════════════════════════════
// CHIAMATA REAL-TIME DAL FRONTEND (apertura modal carta)
// ════════════════════════════════════════════════════════════════════

/**
 * Restituisce il prezzo aggiornato di una variante. Chiamata dal frontend
 * ogni volta che si apre il modal di una carta.
 *
 * Effetti collaterali (se la chiamata riesce):
 *   • aggiorna la colonna last_price nel foglio PORTFOLIO
 *   • ricalcola e salva il valore totale del portfolio nel CONFIG
 */
function getPriceForVariant(token, cardId, condizione, lingua, finitura, blueprintIdGiaNoto) {
  try {
    requireAuth(token);

    var apiKey      = getConfig('cardtrader_api_key');
    var blueprintId = getBlueprintIdForCard(cardId, blueprintIdGiaNoto);
    var risultato   = _fetchPriceFromCardTrader(cardId, condizione, lingua, finitura, blueprintId, apiKey);

    if (risultato.success) {
      _updateLastPriceByVariant(cardId, condizione, lingua, finitura, risultato.price);
      _recalcPortfolioTotal();
    }

    return risultato;
  } catch (errore) {
    Logger.log('[PRICES] ECCEZIONE: ' + errore.message);
    if (errore.message === 'UNAUTHORIZED') {
      return { success: false, price: null, message: 'UNAUTHORIZED' };
    }
    return { success: false, price: null, message: 'Servizio non disponibile.' };
  }
}

/**
 * Aggiorna la colonna last_price (colonna 9) per TUTTE le righe del
 * portfolio che corrispondono alla stessa variante
 * (stessa carta + condizione + lingua + finitura).
 */
function _updateLastPriceByVariant(cardId, condizione, lingua, finitura, prezzo) {
  try {
    var foglio = getSheet('PORTFOLIO');
    var righe  = foglio.getDataRange().getValues();

    for (var i = 1; i < righe.length; i++) {
      var stessaVariante =
        String(righe[i][1]) === String(cardId)     && // card_id
        String(righe[i][3]) === String(condizione) && // condition
        String(righe[i][4]) === String(lingua)     && // language
        String(righe[i][5]) === String(finitura);     // finish

      if (stessaVariante) {
        foglio.getRange(i + 1, 9).setValue(prezzo !== null ? prezzo : '');
      }
    }
  } catch (errore) {
    Logger.log('[PRICES] _updateLastPriceByVariant error: ' + errore.message);
  }
}

/**
 * Ricalcola il valore totale del portfolio sommando
 * (last_price × quantity) di ogni voce, e salva il risultato nel CONFIG
 * insieme alla data dell'aggiornamento. Letto poi da getDashboardData.
 */
function _recalcPortfolioTotal() {
  try {
    var foglio = getSheet('PORTFOLIO');
    var righe  = foglio.getDataRange().getValues();

    var rigaDiPartenza = (righe.length > 0 && righe[0][0] === 'portfolio_id') ? 1 : 0;
    var valoreTotale   = 0;

    for (var i = rigaDiPartenza; i < righe.length; i++) {
      if (!righe[i][0]) continue;
      var prezzo = righe[i][8]; // colonna 9 = last_price
      if (prezzo !== '' && prezzo !== null && prezzo !== undefined) {
        valoreTotale += Number(prezzo) * Number(righe[i][2]); // × quantity
      }
    }

    valoreTotale = parseFloat(valoreTotale.toFixed(2));
    setConfig('portfolio_total_value', valoreTotale);
    setConfig('portfolio_prices_updated', formatDate(new Date()));
  } catch (errore) {
    Logger.log('[PRICES] _recalcPortfolioTotal error: ' + errore.message);
  }
}


// ════════════════════════════════════════════════════════════════════
// TRIGGER BATCH — aggiorna i prezzi di TUTTI gli utenti (MULTI-HOP)
// ════════════════════════════════════════════════════════════════════
// Problema risolto: il giro completo (tutti gli utenti × tutte le voci di
// portfolio, con sleep tra una chiamata CardTrader e l'altra) col tempo
// supera il limite di 6 minuti di Apps Script e l'esecuzione viene tagliata.
//
// Soluzione: il lavoro è spezzato in più esecuzioni ("hop"). Ogni hop:
//   1. legge dove era arrivato (cursore in BATCH_STATE: utente + riga);
//   2. lavora finché restano < 4 minuti di esecuzione;
//   3. se il giro NON è finito, salva lo stato e crea un trigger one-shot
//      che richiama il worker dopo 1 minuto (timer dei 6 min azzerato);
//   4. quando l'ultimo utente è completato, libera il semaforo e si ferma.
//
// Semaforo: un flag persistente "running" in BATCH_STATE protegge l'intero
// giro multi-hop (LockService da solo non basta: il suo lock muore a fine
// esecuzione, non sopravvive tra un hop e l'altro). LockService è usato solo
// come micro-lock attorno alla lettura/scrittura dello stato.
//
// updateAllUsersAllPrices() resta l'ENTRY POINT (kickoff) agganciato al
// time-based trigger notturno: NON serve ricreare il trigger esistente.
// ════════════════════════════════════════════════════════════════════


// ---- Costanti di configurazione del batch ------------------------------
var BATCH_NOME_FOGLIO_STATO  = 'BATCH_STATE';        // foglio nel master
var BATCH_LIMITE_MS          = 4 * 60 * 1000;        // 4 min di lavoro per hop
var BATCH_RITARDO_HOP_MS     = 60 * 1000;            // riprogramma dopo 1 min
var BATCH_FUNZIONE_WORKER    = '_batchWorkerPrezzi'; // nome funzione one-shot


// ════════════════════════════════════════════════════════════════════
// STATO DEL BATCH — lettura/scrittura su foglio BATCH_STATE nel master
// ════════════════════════════════════════════════════════════════════
// Il foglio è chiave/valore (colonna A = chiave, colonna B = valore).
// Chiavi usate:
//   running        'true' | 'false'   — semaforo dell'intero giro
//   user_index     intero             — riga master dell'utente in corso (0-based)
//   row_index      intero             — riga portfolio da cui riprendere (0-based)
//   partial_total  numero             — somma parziale dell'utente in corso
//   run_started    timestamp          — inizio giro (diagnostica)
// ════════════════════════════════════════════════════════════════════

/** Apre (creandolo se manca) il foglio BATCH_STATE nello spreadsheet master. */
function _getBatchStateSheet() {
  var master = SpreadsheetApp.openById(ID_FOGLIO_MASTER_UTENTI);
  var foglio = master.getSheetByName(BATCH_NOME_FOGLIO_STATO);
  if (!foglio) foglio = master.insertSheet(BATCH_NOME_FOGLIO_STATO);
  return foglio;
}

/** Legge tutte le chiavi di stato in un oggetto. Valori assenti → undefined. */
function _leggiStatoBatch() {
  var foglio = _getBatchStateSheet();
  var righe  = foglio.getDataRange().getValues();
  var stato  = {};
  for (var i = 0; i < righe.length; i++) {
    if (righe[i][0]) stato[String(righe[i][0])] = righe[i][1];
  }
  return stato;
}

/** Scrive (o aggiorna) una singola chiave di stato. */
function _scriviStatoBatch(chiave, valore) {
  var foglio = _getBatchStateSheet();
  var righe  = foglio.getDataRange().getValues();
  for (var i = 0; i < righe.length; i++) {
    if (String(righe[i][0]) === chiave) {
      foglio.getRange(i + 1, 2).setValue(valore);
      return;
    }
  }
  foglio.appendRow([chiave, valore]);
}

/** Scrive più chiavi di stato in un colpo solo. */
function _scriviStatoBatchMulti(oggetto) {
  for (var chiave in oggetto) {
    if (oggetto.hasOwnProperty(chiave)) _scriviStatoBatch(chiave, oggetto[chiave]);
  }
}


// ════════════════════════════════════════════════════════════════════
// PULIZIA DEI TRIGGER ONE-SHOT ESAURITI
// ════════════════════════════════════════════════════════════════════

/**
 * Cancella tutti i trigger che puntano al worker. I trigger one-shot
 * (after()) non si auto-rimuovono: senza pulizia si accumulano e saturano
 * la quota. Va chiamata all'inizio di ogni hop (rimuove quello che ha
 * appena fatto partire l'hop corrente) e prima di crearne uno nuovo.
 */
function _pulisciTriggerWorker() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === BATCH_FUNZIONE_WORKER) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

/** Crea il trigger one-shot che richiamerà il worker dopo BATCH_RITARDO_HOP_MS. */
function _programmaProssimoHop() {
  _pulisciTriggerWorker(); // evita duplicati
  ScriptApp.newTrigger(BATCH_FUNZIONE_WORKER)
    .timeBased()
    .after(BATCH_RITARDO_HOP_MS)
    .create();
  Logger.log('[BATCH] Prossimo hop programmato tra ' + (BATCH_RITARDO_HOP_MS / 1000) + 's');
}


// ════════════════════════════════════════════════════════════════════
// KICKOFF — entry point del trigger notturno (NOME INVARIATO)
// ════════════════════════════════════════════════════════════════════

/**
 * Avvia un nuovo giro completo. Chiamata dal time-based trigger notturno.
 *
 * Se un giro precedente è ancora in corso (running === 'true'), salta
 * questa notte con uno skip pulito invece di sovrapporsi.
 */
function updateAllUsersAllPrices() {
  Logger.log('[BATCH] Kickoff updateAllUsersAllPrices');

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30 * 1000); // micro-lock: solo per leggere/scrivere lo stato
  } catch (e) {
    Logger.log('[BATCH] Lock non ottenuto al kickoff, skip.');
    return;
  }

  try {
    var stato = _leggiStatoBatch();
    if (String(stato.running) === 'true') {
      Logger.log('[BATCH] Giro precedente ancora in corso → skip pulito.');
      return;
    }

    // Inizializza cursore e alza il semaforo.
    _scriviStatoBatchMulti({
      running:       'true',
      user_index:    0,
      row_index:     0,
      partial_total: 0,
      run_started:   formatDate(new Date())
    });
  } finally {
    lock.releaseLock();
  }

  // Avvia subito il primo hop (stessa esecuzione: il kickoff lavora già lui).
  _batchWorkerPrezzi();
}


// ════════════════════════════════════════════════════════════════════
// WORKER — esegue un singolo hop e si riprogramma se non ha finito
// ════════════════════════════════════════════════════════════════════

/**
 * Worker del batch multi-hop. Chiamato sia dal kickoff (primo hop) sia dai
 * trigger one-shot (hop successivi). Riprende dal cursore salvato in
 * BATCH_STATE, lavora per un massimo di BATCH_LIMITE_MS, poi:
 *   • se ci sono ancora utenti da processare → salva stato e riprogramma;
 *   • se ha finito → libera il semaforo e si ferma.
 */
function _batchWorkerPrezzi() {
  var inizioHop = Date.now();
  Logger.log('[BATCH] === Hop worker start ===');

  // Rimuove il trigger one-shot che ha fatto partire QUESTO hop (se c'è).
  _pulisciTriggerWorker();

  // ---- Carica lo stato corrente ----
  var stato = _leggiStatoBatch();
  if (String(stato.running) !== 'true') {
    Logger.log('[BATCH] running != true allo start del worker → niente da fare.');
    return;
  }

  var indiceUtente   = Number(stato.user_index) || 0;
  var indiceRiga     = Number(stato.row_index) || 0;
  var totaleParziale = Number(stato.partial_total) || 0;

  // ---- Elenco utenti dal master ----
  var foglioMaster;
  try {
    foglioMaster = getMasterSheet();
  } catch (errore) {
    Logger.log('[BATCH] Impossibile aprire master: ' + errore.message);
    // Non sblocco: riprovo al prossimo hop (problema transitorio possibile).
    _programmaProssimoHop();
    return;
  }

  var righeUtenti = foglioMaster.getDataRange().getValues();
  var numUtenti   = righeUtenti.length;
  Logger.log('[BATCH] Utenti totali: ' + numUtenti + ' | riparto da utente ' +
             indiceUtente + ', riga ' + indiceRiga);

  // ---- Ciclo sugli utenti, ripartendo dal cursore ----
  while (indiceUtente < numUtenti) {
    var username = String(righeUtenti[indiceUtente][0] || '').trim();
    var sheetId  = String(righeUtenti[indiceUtente][2] || '').trim();

    if (!username || !sheetId) {
      // Riga incompleta: passa al prossimo utente da capo.
      indiceUtente++;
      indiceRiga     = 0;
      totaleParziale = 0;
      continue;
    }

    Logger.log('[BATCH] --- Utente ' + indiceUtente + ': ' + username +
               ' (da riga ' + indiceRiga + ') ---');

    // Processa (eventualmente in parte) il portfolio di questo utente.
    var risultatoUtente = _processaUtenteConCheckpoint(
      username, sheetId, indiceRiga, totaleParziale, inizioHop
    );

    if (risultatoUtente.completato) {
      // Utente finito: scrivi totale + storico, poi avanza al successivo.
      _finalizzaUtente(risultatoUtente.spreadsheet, risultatoUtente.totale);
      Logger.log('[BATCH] ' + username + ' COMPLETATO → €' + risultatoUtente.totale);

      indiceUtente++;
      indiceRiga     = 0;
      totaleParziale = 0;

      // Salva il cursore avanzato (così se il prossimo step fallisce,
      // non rifacciamo questo utente).
      _scriviStatoBatchMulti({
        user_index:    indiceUtente,
        row_index:     0,
        partial_total: 0
      });

    } else {
      // Tempo scaduto a metà di questo utente: salva il checkpoint preciso
      // e riprogramma. NON scriviamo total/storico (solo a utente completo).
      _scriviStatoBatchMulti({
        user_index:    indiceUtente,
        row_index:     risultatoUtente.prossimaRiga,
        partial_total: risultatoUtente.totale
      });
      Logger.log('[BATCH] Tempo scaduto su ' + username +
                 ' alla riga ' + risultatoUtente.prossimaRiga + ' → riprogrammo.');
      _programmaProssimoHop();
      return;
    }

    // Dopo aver completato un utente, controlla se resta tempo per il prossimo.
    if (Date.now() - inizioHop >= BATCH_LIMITE_MS) {
      Logger.log('[BATCH] Tempo esaurito dopo un utente completo → riprogrammo.');
      _programmaProssimoHop();
      return;
    }
  }

  // ---- Tutti gli utenti processati: chiudi il giro ----
  _scriviStatoBatchMulti({ running: 'false' });
  Logger.log('[BATCH] === Giro completato. Semaforo liberato. ===');
}


// ════════════════════════════════════════════════════════════════════
// PROCESSO DI UN SINGOLO UTENTE CON CHECKPOINT
// ════════════════════════════════════════════════════════════════════

/**
 * Aggiorna i prezzi del portfolio di un utente partendo dalla riga
 * `rigaDiPartenza` (0-based, riferita all'array di righe del PORTFOLIO),
 * accumulando sul `totaleIniziale`. Si interrompe quando il tempo dell'hop
 * supera BATCH_LIMITE_MS, restituendo il punto di ripresa.
 *
 * @returns {{
 *   completato: boolean,            // true se ha finito tutte le righe dell'utente
 *   totale: number,                 // somma parziale o totale
 *   prossimaRiga: number,           // riga da cui riprendere (se non completato)
 *   spreadsheet: Spreadsheet|null   // handle per finalizzare (se completato)
 * }}
 */
function _processaUtenteConCheckpoint(username, sheetId, rigaDiPartenza, totaleIniziale, inizioHop) {
  // ---- Apri lo spreadsheet dell'utente ----
  var spreadsheet;
  try {
    spreadsheet = SpreadsheetApp.openById(sheetId);
  } catch (errore) {
    Logger.log('[BATCH] ' + username + ': impossibile aprire sheet → skip utente.');
    return { completato: true, totale: totaleIniziale, prossimaRiga: 0, spreadsheet: null };
  }

  var apiKey = _getConfigFromSheet(spreadsheet, 'cardtrader_api_key');
  if (!apiKey) {
    Logger.log('[BATCH] ' + username + ': API key mancante → skip utente.');
    return { completato: true, totale: totaleIniziale, prossimaRiga: 0, spreadsheet: spreadsheet };
  }

  var foglioPortfolio = spreadsheet.getSheetByName('PORTFOLIO');
  if (!foglioPortfolio) {
    Logger.log('[BATCH] ' + username + ': PORTFOLIO non trovato → skip utente.');
    return { completato: true, totale: totaleIniziale, prossimaRiga: 0, spreadsheet: spreadsheet };
  }

  var ultimaRiga = foglioPortfolio.getLastRow();
  if (ultimaRiga <= 1) {
    Logger.log('[BATCH] ' + username + ': portfolio vuoto.');
    return { completato: true, totale: totaleIniziale, prossimaRiga: 0, spreadsheet: spreadsheet };
  }

  var righe          = foglioPortfolio.getRange(1, 1, ultimaRiga, 9).getValues();
  var haHeader       = (righe[0][0] === 'portfolio_id');
  var primaRigaDati  = haHeader ? 1 : 0;

  // La riga di partenza non può essere prima della prima riga di dati.
  var i = Math.max(rigaDiPartenza, primaRigaDati);
  var valoreTotale = totaleIniziale;

  for (; i < righe.length; i++) {
    // ---- Checkpoint temporale: se è scaduto il tempo, esci salvando il punto ----
    if (Date.now() - inizioHop >= BATCH_LIMITE_MS) {
      return {
        completato:   false,
        totale:       parseFloat(valoreTotale.toFixed(2)),
        prossimaRiga: i,
        spreadsheet:  spreadsheet
      };
    }

    var riga = righe[i];
    if (!riga[0]) continue;

    var cardId      = String(riga[1]);
    var quantita    = Number(riga[2]);
    var condizione  = String(riga[3]);
    var lingua      = String(riga[4]);
    var finitura    = String(riga[5]);
    var blueprintId = riga[7]
      ? Number(riga[7])
      : getBlueprintIdFromSheet(spreadsheet, cardId, null);

    var vecchioPrezzoDisponibile = (riga[8] !== '' && riga[8] !== null);

    try {
      var risultato = _fetchPriceFromCardTrader(
        cardId, condizione, lingua, finitura, blueprintId, apiKey
      );

      if (risultato.success && risultato.price !== null) {
        foglioPortfolio.getRange(i + 1, 9).setValue(risultato.price);
        valoreTotale += risultato.price * quantita;
      } else {
        if (vecchioPrezzoDisponibile) valoreTotale += Number(riga[8]) * quantita;
      }
    } catch (errore) {
      Logger.log('[BATCH] ' + username + ' | ' + cardId + ' errore: ' + errore.message);
      if (vecchioPrezzoDisponibile) valoreTotale += Number(riga[8]) * quantita;
    }

    Utilities.sleep(300); // pausa anti-saturazione API CardTrader
  }

  // Tutte le righe dell'utente processate.
  return {
    completato:   true,
    totale:       parseFloat(valoreTotale.toFixed(2)),
    prossimaRiga: 0,
    spreadsheet:  spreadsheet
  };
}

/**
 * Scrive nel CONFIG dell'utente il valore totale e la data, e aggiunge la
 * riga di storico. Chiamata SOLO quando l'utente è stato completato per
 * intero (mai con valore parziale).
 */
function _finalizzaUtente(spreadsheet, valoreTotale) {
  if (!spreadsheet) return;
  _setConfigInSheet(spreadsheet, 'portfolio_total_value', valoreTotale);
  _setConfigInSheet(spreadsheet, 'portfolio_prices_updated', formatDate(new Date()));
  _appendPriceHistoryToSheet(spreadsheet, valoreTotale);
}


// ════════════════════════════════════════════════════════════════════
// HELPER DEL BATCH — versioni di getConfig/setConfig che lavorano su uno
// spreadsheet arbitrario (il batch non ha una sessione, quindi non può
// usare le funzioni di Code.gs che leggono lo sheet della sessione).
// ════════════════════════════════════════════════════════════════════

/** Legge una chiave dal foglio CONFIG di uno spreadsheet arbitrario. */
function _getConfigFromSheet(spreadsheet, chiave) {
  try {
    var foglio = spreadsheet.getSheetByName('CONFIG');
    if (!foglio) return null;

    var righe = foglio.getDataRange().getValues();
    for (var i = 0; i < righe.length; i++) {
      if (String(righe[i][0]) === chiave) return righe[i][1];
    }
  } catch (errore) {
    Logger.log('[BATCH] _getConfigFromSheet: ' + errore.message);
  }
  return null;
}

/** Scrive (o aggiorna) una chiave nel foglio CONFIG di uno spreadsheet arbitrario. */
function _setConfigInSheet(spreadsheet, chiave, valore) {
  try {
    var foglio = spreadsheet.getSheetByName('CONFIG');
    if (!foglio) return;

    var righe = foglio.getDataRange().getValues();
    for (var i = 0; i < righe.length; i++) {
      if (String(righe[i][0]) === chiave) {
        foglio.getRange(i + 1, 2).setValue(valore);
        return;
      }
    }
    foglio.appendRow([chiave, valore]);
  } catch (errore) {
    Logger.log('[BATCH] _setConfigInSheet: ' + errore.message);
  }
}

/**
 * Aggiunge una riga [timestamp, totale] al foglio PRICE_HISTORY di uno
 * spreadsheet arbitrario, creando il foglio se non esiste ancora.
 */
function _appendPriceHistoryToSheet(spreadsheet, valoreTotale) {
  try {
    var foglio = spreadsheet.getSheetByName('PRICE_HISTORY');
    if (!foglio) {
      foglio = spreadsheet.insertSheet('PRICE_HISTORY');
      foglio.appendRow(['timestamp', 'total_value']);
    }
    foglio.appendRow([formatDate(new Date()), valoreTotale]);
  } catch (errore) {
    Logger.log('[BATCH] _appendPriceHistoryToSheet: ' + errore.message);
  }
}


// ════════════════════════════════════════════════════════════════════
// DASHBOARD — statistiche del portfolio
// ════════════════════════════════════════════════════════════════════

/**
 * Restituisce le statistiche mostrate in cima alla sezione Portfolio:
 *   • valore totale (calcolato dall'ultimo aggiornamento prezzi)
 *   • numero totale di carte (somma delle quantità)
 *   • numero di set "coperti" (set con almeno una carta posseduta)
 *   • data dell'ultimo aggiornamento prezzi
 */
function getDashboardData(token) {
  try {
    requireAuth(token);

    var risultatoPortfolio = getPortfolio(token);
    if (!risultatoPortfolio.success) return risultatoPortfolio;

    var vociPortfolio = risultatoPortfolio.items;

    // ---- Mappa card_id → set_id dalla cache (per contare i set coperti) ----
    var righeCarte    = getSheet('CACHE_CARDS').getDataRange().getValues();
    var mappaCartaSet = {};
    for (var i = 1; i < righeCarte.length; i++) {
      if (righeCarte[i][0]) {
        mappaCartaSet[String(righeCarte[i][0])] = String(righeCarte[i][2]);
      }
    }

    // ---- Conta carte totali e set distinti ----
    var totaleCarte   = 0;
    var setPosseduti  = {};

    vociPortfolio.forEach(function(voce) {
      totaleCarte += voce.quantity;
      var setId = mappaCartaSet[voce.card_id];
      if (setId) setPosseduti[setId] = true;
    });

    // ---- Valore totale e data: già calcolati e salvati nel CONFIG ----
    var valoreTotale       = getConfig('portfolio_total_value');
    var ultimoAggiornamento = getConfig('portfolio_prices_updated');

    return {
      success:      true,
      total_value:  (valoreTotale !== null && valoreTotale !== '')
                      ? parseFloat(valoreTotale)
                      : null,
      last_updated: ultimoAggiornamento || null,
      total_cards:  totaleCarte,
      total_sets:   Object.keys(setPosseduti).length
    };
  } catch (errore) {
    if (errore.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: errore.message };
  }
}
