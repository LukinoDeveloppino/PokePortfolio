// ════════════════════════════════════════════════════════════════════
// Sealed.gs — PRODOTTI SIGILLATI (booster box, ETB, booster, blister, …)
// ════════════════════════════════════════════════════════════════════
// Due responsabilità:
//   1. CATALOGO: sync multi-hop dei prodotti sigillati da CardTrader nella
//      cache master SEALED_CACHE, + funzioni di lettura per il frontend.
//   2. MAGAZZINO: CRUD del foglio utente SEALED_PORTFOLIO (speculare a
//      Portfolio.gs / Wishlist.gs).
//
// Perché una sync SEPARATA dalle carte (Cards.gs):
//   • Il catalogo carte è già interamente sincronizzato: intervenire sul
//     worker esistente NON ri-processerebbe i set già in cache (verrebbero
//     saltati), quindi i sigillati non verrebbero mai raccolti.
//   • Una sync dedicata, con proprio cursore in BATCH_STATE (prefisso
//     'sealed_'), è ri-eseguibile e incrementale: fa da backfill iniziale e
//     poi aggiorna solo le espansioni nuove.
//   • È DISACCOPPIATA da SET_CACHE: itera TUTTE le espansioni Pokémon da
//     GET /expansions (non solo quelle con carte singole), così i prodotti
//     "trasversali" (collection box, premium collection, trainer's toolkit,
//     tin con promo di più set…) — che vivono in espansioni dedicate/promo
//     prive di singole, quindi assenti da SET_CACHE — non vengono omessi. I
//     metadati noti (nome/serie) vengono comunque riusati da SET_CACHE quando
//     l'espansione è già lì; altrimenti la serie INT/JP si ricava dal blueprint.
//
// Distinzione carte vs sigillati su CardTrader: il campo `category_id` del
// blueprint. Le carte singole sono la categoria ID_CATEGORIA_CARTA_SINGOLA
// (73); i sigillati hanno altri category_id (Booster Box, Elite Trainer Box,
// Booster, ecc.). Gli ID numerici non sono documentati e cambiano poco: li
// scopriamo a runtime da GET /categories filtrando per NOME (vedi
// _scopriCategorieSigillati). Usa debugSealedCategories() per ispezionarli.
// ════════════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════════════
// COSTANTI
// ════════════════════════════════════════════════════════════════════

// Parole chiave (minuscole) che, se presenti nel NOME della categoria
// CardTrader, la classificano come "prodotto sigillato di set". Elenco
// volutamente generoso: la sync è comunque limitata al gioco Pokémon.
var PAROLE_CHIAVE_SIGILLATI = [
  'box', 'booster', 'tin', 'blister', 'bundle', 'collection',
  'display', 'deck', 'case', 'pack', 'elite trainer', 'etb', 'premium'
];

// Parole chiave che ESCLUDONO una categoria anche se matcha sopra: sono
// accessori o prodotti non legati a un set (non interessano al negoziante
// che traccia i sigillati). Es. "Deck Box" (accessorio) contiene 'box' ma
// va escluso; le buste/tappetini idem.
var PAROLE_CHIAVE_ESCLUSE_SIGILLATI = [
  'sleeve', 'playmat', 'play mat', 'dice', 'toploader', 'binder',
  'album', 'portfolio', 'deck box', 'card box', 'storage'
];

// Colonne del foglio master SEALED_CACHE (1-based):
//   1 id            <set_id>_<blueprint_id> (chiave, come CACHE_CARDS)
//   2 name          nome del prodotto
//   3 set_id        id espansione CardTrader (== set_id in SET_CACHE)
//   4 set_name      nome del set
//   5 set_series    'INT' | 'JP'  (ereditato da SET_CACHE)
//   6 category_name tipo prodotto ("Booster Box", "Elite Trainer Box", …)
//   7 image_url     immagine del prodotto
//   8 last_updated  timestamp ultimo aggiornamento
//   9 blueprint_id  id CardTrader (per i prezzi)
var INTESTAZIONE_SEALED_CACHE = ['id', 'name', 'set_id', 'set_name',
  'set_series', 'category_name', 'image_url', 'last_updated', 'blueprint_id'];

// Stato multi-hop nel foglio BATCH_STATE del master (prefisso 'sealed_'):
//   sealed_running     'true' | 'false'
//   sealed_cursor       id set su cui riprendere | 'DONE'
//   sealed_scanned      JSON array dei set_id già scansionati (anche quelli
//                       senza sigillati: evita di ri-scaricarne i blueprint)
//   sealed_last_sync    timestamp ultimo giro completato
//   sealed_run_started  timestamp inizio giro corrente
var SEALED_SYNC_FUNZIONE_WORKER = '_syncWorkerSealed';


// Restituisce (creandolo con l'intestazione se manca) il foglio SEALED_CACHE
// nel master. getSheet('SEALED_CACHE') lancerebbe un errore se il foglio non
// esiste ancora: questo helper è auto-creante, così la prima sync e i reader
// non falliscono prima che il catalogo sia mai stato popolato.
function _getFoglioSealedCache() {
  var master = _getMasterSpreadsheet();
  var foglio = master.getSheetByName('SEALED_CACHE');
  if (!foglio) {
    foglio = master.insertSheet('SEALED_CACHE');
    foglio.appendRow(INTESTAZIONE_SEALED_CACHE);
  }
  return foglio;
}


// Ricava la serie (INT/JP) di un'espansione dai prodotti sigillati: cerca la
// proprietà editable `pokemon_language` (default_value 'jp' → JP), come fa la
// sync delle carte. Default 'INT' se nessun prodotto la espone. Usato per le
// espansioni non presenti in SET_CACHE (dove la serie sarebbe altrimenti ignota).
function _serieDaBlueprintSigillati(prodotti) {
  for (var i = 0; i < prodotti.length; i++) {
    var props = prodotti[i].editable_properties || [];
    for (var p = 0; p < props.length; p++) {
      if (props[p].name === 'pokemon_language') {
        return props[p].default_value === 'jp' ? 'JP' : 'INT';
      }
    }
  }
  return 'INT';
}


// ════════════════════════════════════════════════════════════════════
// SCOPERTA DELLE CATEGORIE SIGILLATE (GET /categories)
// ════════════════════════════════════════════════════════════════════

// Interroga CardTrader e costruisce la mappa { category_id → nome } delle
// sole categorie sigillate Pokémon (per nome, vedi PAROLE_CHIAVE_*).
// Restituisce { mappa: {id:nome}, ids: {id:true} } oppure null se l'API
// non risponde (in tal caso la sync salta il giro senza rompere nulla).
function _scopriCategorieSigillati(apiKey) {
  var categorie = chiamaCardTrader(URL_BASE_API_CARDTRADER + '/categories', apiKey);
  if (!Array.isArray(categorie)) {
    Logger.log('[SEALED] /categories non disponibile: ' +
               (categorie && categorie._error ? categorie._error : 'risposta non valida'));
    return null;
  }

  var mappa = {};
  var ids   = {};
  categorie.forEach(function(cat) {
    if (!cat || cat.game_id !== ID_GIOCO_POKEMON_SU_CARDTRADER) return;
    if (cat.id === ID_CATEGORIA_CARTA_SINGOLA) return;   // carte singole: escluse

    var nome = String(cat.name || '').toLowerCase();
    if (!nome) return;

    var esclusa = PAROLE_CHIAVE_ESCLUSE_SIGILLATI.some(function(k) {
      return nome.indexOf(k) !== -1;
    });
    if (esclusa) return;

    var sigillata = PAROLE_CHIAVE_SIGILLATI.some(function(k) {
      return nome.indexOf(k) !== -1;
    });
    if (!sigillata) return;

    mappa[String(cat.id)] = cat.name;
    ids[String(cat.id)]   = true;
  });

  Logger.log('[SEALED] Categorie sigillate riconosciute: ' + JSON.stringify(mappa));
  return { mappa: mappa, ids: ids };
}

// Utility diagnostica da lanciare A MANO nell'editor Apps Script: stampa
// TUTTE le categorie Pokémon con id e nome, evidenziando quali vengono
// classificate come sigillate. Serve per tarare PAROLE_CHIAVE_SIGILLATI /
// PAROLE_CHIAVE_ESCLUSE_SIGILLATI sul catalogo reale prima di fidarsi.
function debugSealedCategories() {
  var apiKey = getCardTraderApiKey();
  if (!apiKey) { Logger.log('[SEALED][DEBUG] Nessuna API key nel master.'); return; }

  var categorie = chiamaCardTrader(URL_BASE_API_CARDTRADER + '/categories', apiKey);
  if (!Array.isArray(categorie)) {
    Logger.log('[SEALED][DEBUG] /categories non disponibile.');
    return;
  }

  var riconosciute = _scopriCategorieSigillati(apiKey).ids;
  categorie
    .filter(function(c) { return c && c.game_id === ID_GIOCO_POKEMON_SU_CARDTRADER; })
    .forEach(function(c) {
      var tag = (c.id === ID_CATEGORIA_CARTA_SINGOLA)
        ? '[CARTA SINGOLA]'
        : (riconosciute[String(c.id)] ? '[SIGILLATO ✓]' : '[ignorata]');
      Logger.log('[SEALED][DEBUG] id=' + c.id + '  ' + tag + '  ' + c.name);
    });
}


// ════════════════════════════════════════════════════════════════════
// SYNC CATALOGO SIGILLATI — KICKOFF (trigger temporizzato o manuale)
// ════════════════════════════════════════════════════════════════════

function syncSealedCatalog() {
  Logger.log('[SEALED] Kickoff syncSealedCatalog');

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30 * 1000);
  } catch (e) {
    Logger.log('[SEALED] Lock non ottenuto al kickoff, skip.');
    return;
  }

  try {
    var stato = _kvLeggiTutti(_getBatchStateFoglio());
    if (String(stato.sealed_running) === 'true') {
      Logger.log('[SEALED] Giro precedente ancora in corso → skip pulito.');
      return;
    }

    // Cursore azzerato a ogni kickoff: si ri-scorre SET_CACHE saltando i set
    // già scansionati (registro sealed_scanned), così i set nuovi vengono
    // raccolti senza ri-scaricare i blueprint di quelli già fatti.
    _kvScriviMulti(_getBatchStateFoglio(), {
      sealed_running:     'true',
      sealed_cursor:      '',
      sealed_run_started: formatDate(new Date())
    });
  } finally {
    lock.releaseLock();
  }

  _syncWorkerSealed();
}


// ════════════════════════════════════════════════════════════════════
// SYNC CATALOGO SIGILLATI — WORKER (un hop, poi si riprogramma)
// ════════════════════════════════════════════════════════════════════

function _syncWorkerSealed() {
  var istanteInizio = Date.now();
  Logger.log('[SEALED] === Hop worker start ===');

  _pulisciTrigger(SEALED_SYNC_FUNZIONE_WORKER);

  var stato = _kvLeggiTutti(_getBatchStateFoglio());
  if (String(stato.sealed_running) !== 'true') {
    Logger.log('[SEALED] sealed_running != true → niente da fare.');
    return;
  }

  var dataOraAdesso = formatDate(new Date());

  try {
    var apiKey = getCardTraderApiKey();
    if (!apiKey) {
      Logger.log('[SEALED] Nessuna API key nel master → stop giro.');
      _kvScrivi(_getBatchStateFoglio(), 'sealed_running', 'false');
      return;
    }

    // ---- 1. Scopri le categorie sigillate (per nome) ----
    var categorie = _scopriCategorieSigillati(apiKey);
    if (!categorie || Object.keys(categorie.ids).length === 0) {
      Logger.log('[SEALED] Nessuna categoria sigillata scoperta → riprovo al prossimo hop.');
      _programmaTrigger(SEALED_SYNC_FUNZIONE_WORKER, SYNC_RITARDO_HOP_MS);
      return;
    }

    // ---- 2. Scarica TUTTE le espansioni Pokémon (non solo quelle in SET_CACHE) ----
    // La sync è DISACCOPPIATA da SET_CACHE: molti prodotti "trasversali"
    // (collection box, premium collection, trainer's toolkit, tin con promo di
    // più set…) vivono in espansioni dedicate/promo prive di carte singole,
    // quindi assenti da SET_CACHE. Iterando l'elenco completo delle espansioni
    // NON vengono più omessi. Nessuna blacklist qui: il filtro per category_id
    // sigillato scarta comunque tutto ciò che non è un prodotto sigillato.
    var tutteLeEspansioni = chiamaCardTrader(URL_BASE_API_CARDTRADER + '/expansions', apiKey);
    if (tutteLeEspansioni._error || !Array.isArray(tutteLeEspansioni)) {
      Logger.log('[SEALED] Errore espansioni: ' +
                 (tutteLeEspansioni._error || 'non array') + ' → riprovo al prossimo hop.');
      _programmaTrigger(SEALED_SYNC_FUNZIONE_WORKER, SYNC_RITARDO_HOP_MS);
      return;
    }
    var espansioni = tutteLeEspansioni.filter(function(e) {
      return e.game_id === ID_GIOCO_POKEMON_SU_CARDTRADER;
    });
    Logger.log('[SEALED] Espansioni Pokémon totali: ' + espansioni.length);

    // Metadati (nome/serie) dei set già noti da SET_CACHE: quando disponibili
    // sono autorevoli e allineati alle tab INT/JP del catalogo carte. Per le
    // espansioni non presenti si ricava la serie dalle proprietà del blueprint.
    var metaSet = {};
    try {
      var foglioSet = getSheet('SET_CACHE');
      if (foglioSet.getLastRow() > 1) {
        var righeSet = foglioSet.getRange(1, 1, foglioSet.getLastRow(), 3).getValues();
        for (var m = 1; m < righeSet.length; m++) {
          if (righeSet[m][0]) {
            metaSet[String(righeSet[m][0])] = {
              name:   String(righeSet[m][1] || ''),
              series: String(righeSet[m][2] || 'INT')
            };
          }
        }
      }
    } catch (e) { Logger.log('[SEALED] SET_CACHE non leggibile: ' + e.message); }

    var foglioSealed = _getFoglioSealedCache();

    // ---- 3. Registro delle espansioni già scansionate (anche senza sigillati) ----
    var scansionati = {};
    try {
      JSON.parse(stato.sealed_scanned || '[]').forEach(function(id) {
        scansionati[String(id)] = true;
      });
    } catch (e) { scansionati = {}; }

    // ---- 4. Riprendi dal cursore salvato (id dell'ultima espansione fatta) ----
    var cursore   = String(stato.sealed_cursor || '');
    var idCursore = (cursore && cursore !== 'DONE') ? parseInt(cursore, 10) : 0;
    var indicePartenza = 0;
    if (idCursore > 0) {
      for (var k = 0; k < espansioni.length; k++) {
        if (espansioni[k].id === idCursore) { indicePartenza = k + 1; break; }
      }
    }

    var contatoreNuovi = 0;

    // ---- 5. Ciclo: un'espansione alla volta ----
    for (var s = indicePartenza; s < espansioni.length; s++) {
      if (Date.now() - istanteInizio > SYNC_LIMITE_MS) {
        _kvScriviMulti(_getBatchStateFoglio(), {
          sealed_cursor:  String(espansioni[s > 0 ? s - 1 : 0].id),
          sealed_scanned: JSON.stringify(Object.keys(scansionati))
        });
        Logger.log('[SEALED] Limite tempo a ' + s + '/' + espansioni.length + ' → riprogrammo.');
        _programmaTrigger(SEALED_SYNC_FUNZIONE_WORKER, SYNC_RITARDO_HOP_MS);
        return;
      }

      var espansione = espansioni[s];
      var setId      = String(espansione.id);
      if (!setId) continue;

      if (scansionati[setId]) {                    // già fatta in un giro precedente
        _kvScrivi(_getBatchStateFoglio(), 'sealed_cursor', setId);
        continue;
      }

      // ---- 5a. Scarica i blueprint dell'espansione ----
      var blueprint = chiamaCardTrader(
        URL_BASE_API_CARDTRADER + '/blueprints/export?expansion_id=' + espansione.id,
        apiKey
      );
      if (blueprint._error || !Array.isArray(blueprint)) {
        Logger.log('[SEALED] Skip ' + espansione.name + ': ' + (blueprint._error || 'non array'));
        // Non marco scansionata: riproverò al prossimo giro.
        _kvScrivi(_getBatchStateFoglio(), 'sealed_cursor', setId);
        continue;
      }

      // ---- 5b. Filtra i soli prodotti sigillati (per category_id) ----
      var sigillati = blueprint.filter(function(bp) {
        return categorie.ids[String(bp.category_id)];
      });

      // ---- 5c. Scrivi le righe (se ce ne sono) ----
      if (sigillati.length > 0) {
        // Nome/serie: da SET_CACHE se noti, altrimenti dall'espansione e dalle
        // proprietà del blueprint (pokemon_language → JP/INT, default INT).
        var meta      = metaSet[setId];
        var setName   = meta ? meta.name   : (espansione.name || '');
        var setSeries = meta ? meta.series : _serieDaBlueprintSigillati(sigillati);

        var righeDaScrivere = sigillati.map(function(bp) {
          return [
            setId + '_' + bp.id,
            bp.name || '',
            setId,
            setName,
            setSeries,
            categorie.mappa[String(bp.category_id)] || 'Sigillato',
            bp.image_url || '',
            dataOraAdesso,
            bp.id
          ];
        });
        foglioSealed
          .getRange(foglioSealed.getLastRow() + 1, 1, righeDaScrivere.length, INTESTAZIONE_SEALED_CACHE.length)
          .setValues(righeDaScrivere);
        contatoreNuovi += righeDaScrivere.length;
        Logger.log('[SEALED] ' + espansione.name + ' → ' + sigillati.length + ' prodotti sigillati');
      }

      // ---- 5d. Marca l'espansione come scansionata e avanza il cursore ----
      // Il registro scansionati serve SOLO a saltare le espansioni nei giri
      // futuri: entro questo giro la ripresa avviene via cursore. Per non
      // scrivere una stringa JSON crescente a ogni set, lo persisto solo al
      // checkpoint di tempo scaduto e a fine giro; qui aggiorno solo il cursore.
      scansionati[setId] = true;
      _kvScrivi(_getBatchStateFoglio(), 'sealed_cursor', setId);
    }

    // ---- 6. Giro completato ----
    _kvScriviMulti(_getBatchStateFoglio(), {
      sealed_cursor:    'DONE',
      sealed_scanned:   JSON.stringify(Object.keys(scansionati)),
      sealed_last_sync: dataOraAdesso,
      sealed_running:   'false'
    });
    Logger.log('[SEALED] Completata. Nuovi prodotti in questo giro: ' + contatoreNuovi);

  } catch (errore) {
    Logger.log('[SEALED] Errore: ' + errore.message + ' → libero il semaforo.');
    try { _kvScrivi(_getBatchStateFoglio(), 'sealed_running', 'false'); } catch (e) {}
  }
}


// ════════════════════════════════════════════════════════════════════
// LETTURA DEL CATALOGO SIGILLATI (funzioni chiamate dal frontend)
// ════════════════════════════════════════════════════════════════════

// Converte una riga grezza di SEALED_CACHE in un oggetto prodotto.
function convertiRigaInProdotto(riga) {
  return {
    id:            String(riga[0]),
    name:          String(riga[1] || ''),
    set_id:        String(riga[2] || ''),
    set_name:      String(riga[3] || ''),
    set_series:    String(riga[4] || ''),
    category_name: String(riga[5] || ''),
    image_url:     String(riga[6] || ''),
    blueprint_id:  riga[8] ? Number(riga[8]) : null,
    is_jp:         String(riga[4] || '') === 'JP'
  };
}

// Scansiona SEALED_CACHE e restituisce i prodotti per cui testFn(riga) = true.
function _cercaProdotti(testFn) {
  var foglio     = _getFoglioSealedCache();
  var ultimaRiga = foglio.getLastRow();
  if (ultimaRiga <= 1) return [];

  var righe     = foglio.getRange(1, 1, ultimaRiga, INTESTAZIONE_SEALED_CACHE.length).getValues();
  var risultati = [];
  for (var i = 1; i < righe.length; i++) {
    if (!righe[i][0]) continue;
    if (testFn(righe[i])) {
      try { risultati.push(convertiRigaInProdotto(righe[i])); } catch (e) {}
    }
  }
  return risultati;
}

// Elenco dei set che hanno prodotti sigillati, con conteggio prodotti e
// metadati (logo/data) presi da SET_CACHE.
function getSealedSetList(token) {
  return _wrapApiCall(function() {
    requireAuth(token);

    var foglio     = _getFoglioSealedCache();
    var ultimaRiga = foglio.getLastRow();
    if (ultimaRiga <= 1) {
      return {
        success:   true,
        sets:      [],
        empty:     true,
        last_sync: String(_kvLeggiTutti(_getBatchStateFoglio()).sealed_last_sync || '')
      };
    }

    // Logo e data uscita dei set dal SET_CACHE (per il badge del set).
    var mappaSet   = {};
    var foglioSet  = getSheet('SET_CACHE');
    if (foglioSet.getLastRow() > 1) {
      var righeSet = foglioSet.getRange(1, 1, foglioSet.getLastRow(), 7).getValues();
      for (var m = 1; m < righeSet.length; m++) {
        if (!righeSet[m][0]) continue;
        mappaSet[String(righeSet[m][0])] = {
          logo: String(righeSet[m][3] || ''),
          data: String(righeSet[m][4] || '')
        };
      }
    }

    // Raggruppa i prodotti per set contando quanti sono.
    var righe = foglio.getRange(1, 1, ultimaRiga, INTESTAZIONE_SEALED_CACHE.length).getValues();
    var perSet = {};
    var ordine = [];
    for (var i = 1; i < righe.length; i++) {
      if (!righe[i][0]) continue;
      var setId = String(righe[i][2]);
      if (!perSet[setId]) {
        var meta = mappaSet[setId] || { logo: '', data: '' };
        perSet[setId] = {
          set_id:        setId,
          set_name:      String(righe[i][3] || ''),
          set_series:    String(righe[i][4] || ''),
          set_logo_url:  meta.logo,
          release_date:  meta.data,
          product_count: 0
        };
        ordine.push(setId);
      }
      perSet[setId].product_count++;
    }

    return {
      success:   true,
      sets:      ordine.map(function(id) { return perSet[id]; }),
      empty:     ordine.length === 0,
      last_sync: String(_kvLeggiTutti(_getBatchStateFoglio()).sealed_last_sync || '')
    };
  });
}

function getSealedForSet(token, setId) {
  return _wrapApiCall(function() {
    requireAuth(token);
    var idSetCercato = String(setId);
    var prodotti = _cercaProdotti(function(r) { return String(r[2]) === idSetCercato; });
    return { success: true, products: prodotti };
  });
}

function getSealedForIds(token, ids) {
  return _wrapApiCall(function() {
    requireAuth(token);
    if (!ids || !ids.length) return { success: true, products: [] };

    var daCercare = {};
    ids.forEach(function(id) { daCercare[String(id)] = true; });

    var prodotti = _cercaProdotti(function(r) { return !!daCercare[String(r[0])]; });
    return { success: true, products: prodotti };
  });
}

function searchSealed(token, testoCercato) {
  return _wrapApiCall(function() {
    requireAuth(token);
    if (!testoCercato || testoCercato.trim().length < 2) return { success: true, products: [] };

    var query = testoCercato.trim().toLowerCase();
    var prodotti = _cercaProdotti(function(r) {
      return String(r[1]).toLowerCase().indexOf(query) !== -1;
    });
    return { success: true, products: prodotti };
  });
}


// ════════════════════════════════════════════════════════════════════
// MAGAZZINO SIGILLATI — CRUD del foglio SEALED_PORTFOLIO
// ════════════════════════════════════════════════════════════════════
// Speculare a Portfolio.gs / Wishlist.gs. Le 9 colonne sono identiche così
// il batch prezzi e lo storico riusano la stessa logica generica; per i
// sigillati condition/finish sono placeholder fissi ('Sealed'/'Normal'),
// mentre language è significativa e filtra il prezzo su CardTrader.
//   1 sealed_id · 2 card_id (id SEALED_CACHE) · 3 quantity · 4 condition
//   5 language · 6 finish · 7 date_added · 8 blueprint_id · 9 last_price

var SEALED_CONDIZIONE_PLACEHOLDER = 'Sealed';
var SEALED_FINITURA_PLACEHOLDER   = 'Normal';

function convertiRigaInVoceSealed(riga) {
  return {
    sealed_id:    String(riga[0]),
    card_id:      String(riga[1]),
    quantity:     Number(riga[2]),
    condition:    String(riga[3]),
    language:     String(riga[4]),
    finish:       String(riga[5]),
    date_added:   String(riga[6]),
    blueprint_id: riga[7] ? Number(riga[7]) : null,
    last_price:   (riga[8] !== '' && riga[8] !== null && riga[8] !== undefined)
                    ? Number(riga[8])
                    : null
  };
}

// Cerca una voce per sealedId nel foglio SEALED_PORTFOLIO.
function _trovaRigaSealed(sealedId) {
  var foglio = getSheet('SEALED_PORTFOLIO');
  var righe  = foglio.getDataRange().getValues();
  for (var i = 1; i < righe.length; i++) {
    if (String(righe[i][0]) === String(sealedId)) {
      return { foglio: foglio, righe: righe, indice: i };
    }
  }
  return null;
}

function getSealed(token) {
  return _wrapApiCall(function() {
    requireAuth(token);

    var foglio     = getSheet('SEALED_PORTFOLIO');
    var ultimaRiga = foglio.getLastRow();
    if (ultimaRiga <= 1) return { success: true, items: [] };

    var righe          = foglio.getRange(1, 1, ultimaRiga, 9).getValues();
    var rigaDiPartenza = _primaRigaDati(righe, 'sealed_id');
    var voci = [];
    for (var i = rigaDiPartenza; i < righe.length; i++) {
      if (!righe[i][0]) continue;
      voci.push(convertiRigaInVoceSealed(righe[i]));
    }

    return { success: true, items: voci };
  });
}

// Aggiunge un prodotto sigillato al magazzino. condition/finish sono fissi
// (un sigillato non ne ha); language serve per filtrare il prezzo.
function addToSealed(token, cardId, quantity, language, blueprintId) {
  return _wrapApiCall(function() {
    requireAuth(token);

    if (!cardId || !quantity || !language) {
      return { success: false, error: 'Prodotto, quantità e lingua sono obbligatori.' };
    }
    if (!blueprintId) {
      return { success: false, error: 'blueprint_id mancante: impossibile seguire il prezzo.' };
    }

    var nuovoId = Utilities.getUuid();

    getSheet('SEALED_PORTFOLIO').appendRow([
      nuovoId,
      cardId,
      quantity,
      SEALED_CONDIZIONE_PLACEHOLDER,
      language,
      SEALED_FINITURA_PLACEHOLDER,
      formatDate(new Date()),
      blueprintId,
      ''
    ]);

    return { success: true, sealed_id: nuovoId };
  });
}

function incrementSealedItem(token, sealedId, delta) {
  return _wrapApiCall(function() {
    requireAuth(token);

    var trovato = _trovaRigaSealed(sealedId);
    if (!trovato) return { success: false, error: 'Voce non trovata.' };

    var nuovaQuantita = parseInt(trovato.righe[trovato.indice][2], 10) + parseInt(delta, 10);
    if (nuovaQuantita <= 0) {
      return { success: false, error: 'Usa deleteSealedItem per rimuovere la voce.' };
    }

    trovato.foglio.getRange(trovato.indice + 1, 3).setValue(nuovaQuantita);
    return { success: true, new_quantity: nuovaQuantita };
  });
}

function deleteSealedItem(token, sealedId) {
  return _wrapApiCall(function() {
    requireAuth(token);

    var trovato = _trovaRigaSealed(sealedId);
    if (!trovato) return { success: false, error: 'Voce non trovata.' };

    trovato.foglio.deleteRow(trovato.indice + 1);
    return { success: true };
  });
}
