// ════════════════════════════════════════════════════════════════════
// Cards.gs — CATALOGO CARTE (dati scaricati dall'API CardTrader)
// ════════════════════════════════════════════════════════════════════
// Questo file gestisce:
//   1. La SINCRONIZZAZIONE del catalogo: scarica da CardTrader la lista
//      delle espansioni (set) Pokémon e tutte le loro carte singole, e le
//      salva nei fogli SET_CACHE e CACHE_CARDS dell'utente.
//      La sync supporta la ripresa automatica ("cursor") perché le funzioni
//      Apps Script hanno un timeout massimo di 6 minuti.
//   2. La LETTURA del catalogo dalla cache (lista set, carte di un set,
//      ricerca per nome) — chiamata dal frontend.
//
// Nota terminologia CardTrader:
//   • "expansion" = un set di carte (es. "Scarlet & Violet 151")
//   • "blueprint" = una singola carta/prodotto all'interno di un set
// ════════════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════════════
// COSTANTI
// ════════════════════════════════════════════════════════════════════

// URL base dell'API CardTrader v2 (usato anche da Prices.gs).
var URL_BASE_API_CARDTRADER = 'https://api.cardtrader.com/api/v2';

// Su CardTrader ogni gioco ha un ID numerico: 5 = Pokémon TCG.
var ID_GIOCO_POKEMON_SU_CARDTRADER = 5;

// Su CardTrader ogni prodotto ha una categoria: 73 = carta singola
// (esclude buste, box, accessori, ecc.).
var ID_CATEGORIA_CARTA_SINGOLA = 73;

// Espansioni da ESCLUDERE dalla sync (set vecchi, prodotti sealed,
// deck kit, promo non interessanti, ecc.).
// Logica: tutto ciò che NON è in questa blacklist viene incluso
// automaticamente — quindi anche i set futuri verranno scaricati senza
// dover toccare il codice.
var ID_ESPANSIONI_ESCLUSE = [/*
  1468,1469,1470,1471,1472,1473,1474,1475,1476,1477,
  1478,1479,1480,1481,1482,1483,1484,1485,1486,1487,
  1488,1491,1492,1493,1494,1496,1498,1499,1500,1501,
  1502,1503,1504,1505,1506,1507,1508,1509,1510,1511,
  1512,1513,1514,1515,1516,1517,1518,1519,1520,1521,
  1522,1523,1524,1525,1526,1527,1528,1529,1530,1531,
  1532,1533,1535,1536,1537,1538,1539,1540,1541,1542,
  1543,1544,1545,1546,1547,1548,1549,1551,1552,1553,
  1554,1555,1556,1557,1558,1559,1561,1562,1563,1564,
  1565,1566,1567,1568,1569,1570,1571,1572,1573,1574,
  1575,1576,1577,1578,1579,1580,1581,1586,1587,1588,
  1589,1590,1591,1594,1599,1600,1601,1602,1603,1604,
  1606,1611,1612,1613,1614,1615,1616,1617,1635,1646,
  1647,1648,1649,1853,1860,1868,1869,1870,1873,1874,
  1876,1877,1878,1880,1883,1884,1887,1888,1889,1890,
  1891,1892,1893,1894,1895,1896,1897,1898,1901,1902,
  1903,1906,1907,1908,1910,1911,1913,1914,1915,1916,
  1918,1920,1921,1922,1926,1927,1928,1929,1930,1931,
  1932,1933,1934,1935,1936,1937,1938,1939,1940,1941,
  1942,1943,1944,1945,1946,1947,1948,1949,1950,1955,
  1969,1970,1971,1972,1973,1974,1975,1976,1977,1978,
  1979,1980,1981,1982,1983,1984,1985,1986,1987,1988,
  1989,1990,1991,1992,1993,1994,1995,1996,1997,1998,
  1999,2000,2001,2002,2003,2004,2005,2007,2008,2009,
  2010,2011,2012,2013,2014,2015,2016,2017,2018,2019,
  2020,2021,2022,2023,2024,2025,2026,2027,2028,2029,
  2030,2031,2032,2033,2034,2035,2036,2037,2038,2039,
  2040,2041,2042,2043,2044,2045,2046,2047,2048,2049,
  2050,2051,2052,2053,2054,2055,2056,2057,2058,2059,
  2060,2061,2062,2063,2064,2065,2066,2067,2068,2069,
  2070,2071,2072,2073,2094,2095,2101,2108,2112,2124,
  2125,2128,2139,2150,2174,2185,2186,2187,2613,2627,
  2781,2782,2783,2917,2918,2919,2937,2938,3057,3138,
  3141,3155,3158,3195,3196,3197,3198,3201,3202,3204,
  3205,3206,3240,3241,3242,3243,3269,3272,3273,3304,
  3338,3339,3340,3341,3342,3347,3348,3349,3350,3351,
  3352,3388,3389,3390,3391,3404,3405,3406,3407,3408,
  3409,3410,3411,3412,3413,3414,3415,3416,3417,3418,
  3419,3420,3421,3422,3423,3424,3425,3426,3427,3428,
  3429,3430,3431,3432,3437,3438,3439,3440,3442,3444,
  3445,3446,3447,3448,3449,3450,3451,3452,3456,3467,
  3520,3522,3523,3524,3535,3536,3537,3538,3547,3548,
  3549,3550,3551,3552,3553,3554,3578,3579,3583,3588,
  3589,3593,3594,3608,3609,3616,3652,3653,3655,3656,
  3665,3679,3680,3681,3682,3683,3684,3685,3686,3688,
  3689,3690,3691,3692,3694,3695,3696,3697,3698,3699,
  3700,3701,3702,3703,3704,3705,3708,3709,3710,3711,
  3712,3713,3714,3716,3717,3718,3719,3720,3721,3724,
  3725,3730,3731,3732,3733,3734,3746,3748,3752,3754,
  3758,3759,3778,3786,3794,3796,3802,3803,3811,3812,
  3813,3814,3815,3816,3817,3819,3822,3824,3825,3826,
  3855,3864,3896,3903,3904,3927,3935,3936,3939,3940,
  3942,3946,3947,3948,3949,3950,3951,3952,3953,3954,
  3955,3956,3957,3958,3959,3960,3961,3962,3963,3964,
  3965,3966,3967,3974,3975,3976,3983,3984,3985,3986,
  3989,3997,3998,3999,4000,4004,4005,4006,4007,4009,
  4010,4011,4012,4013,4014,4015,4016,4017,4018,4019,
  4020,4021,4022,4023,4024,4025,4026,4027,4028,4029,
  4030,4031,4032,4035,4041,4042,4043,4044,4045,4046,
  4047,4048,4049,4050,4051,4052,4053,4063,4064,4067,
  4068,4069,4070,4072,4073,4074,4075,4076,4089,4094,
  4095,4110,4112,4113,4114,4115,4151,4158,4160,4161,
  4162,4163,4187,4200,4201,4210,4222,4223,4237,4238,
  4263,4264,4265,4266,4267,4274,4277,4278,4279,4280,
  4290,4291,4292,4312,4322,4336,4337,4339,4366,4367,
  4368,4373,4374,4382,4403,4404,4405,4406,4407,4408,
  4414,4427,4432,4460,4461,4469,4471,4472,4473,4474,
  4475,4476,4477,4478,4479,4480,4481,4482,4483,4484,
  4485,4486,4487,4488,4489,4492,4493,4494,4498,4500,
  4501,4502,4503,4504,4505,4506,4507,4508,4509,4510,
  4511,4512,4513,4514,4515,4516,4517,4518,4519,4531,
  4544,4545,4558,4559,4560,4565,4566,4587,4590,4591,
  4592,4595,4596,4597,4607,4610,4628,4638,4639,4643,
  4644,4645,4655,4656,4657,4669*/
];


// ════════════════════════════════════════════════════════════════════
// LOGHI E DATE DEI SET (dal repository GitHub di PokemonTCG)
// ════════════════════════════════════════════════════════════════════
// CardTrader non fornisce il logo dei set né la data di uscita.
// Per i set internazionali li recuperiamo dal file JSON pubblico del
// progetto PokemonTCG su GitHub, costruendo una mappa:
//     nome set (minuscolo) → { logo, releaseDate }
// ════════════════════════════════════════════════════════════════════

// Cache in memoria: evita di riscaricare il JSON da GitHub a ogni set.
// Vive solo per la durata dell'esecuzione corrente di Apps Script.
var _cacheMappaSetGithub = null;

/**
 * Scarica (una sola volta per esecuzione) la mappa dei set internazionali
 * dal repository GitHub di PokemonTCG.
 * In caso di errore restituisce una mappa vuota: la sync prosegue
 * semplicemente senza loghi/date per quei set.
 */
function getGithubSetsMap() {
  if (_cacheMappaSetGithub) return _cacheMappaSetGithub;

  try {
    var risposta = UrlFetchApp.fetch(
      'https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/sets/en.json',
      { muteHttpExceptions: true }
    );
    if (risposta.getResponseCode() !== 200) return {};

    var mappa = {};
    JSON.parse(risposta.getContentText()).forEach(function(set) {
      mappa[set.name.toLowerCase()] = {
        logo:        (set.images && set.images.logo) ? set.images.logo : '',
        releaseDate: set.releaseDate || ''
      };
    });

    _cacheMappaSetGithub = mappa;
    return mappa;
  } catch (errore) {
    return {};
  }
}


// ════════════════════════════════════════════════════════════════════
// HELPER HTTP PER CARDTRADER
// ════════════════════════════════════════════════════════════════════

/**
 * Costruisce gli header di autenticazione per le chiamate a CardTrader,
 * leggendo la API key dal foglio CONFIG dell'utente loggato.
 */
function headerAutenticazioneCardTrader() {
  return { 'Authorization': 'Bearer ' + getConfig('cardtrader_api_key') };
}

/**
 * Esegue una GET sull'API CardTrader e restituisce il JSON già parsato.
 * In caso di problemi restituisce un oggetto { _error: '...' } che il
 * chiamante può controllare.
 */
function chiamaCardTrader(url) {
  var risposta = UrlFetchApp.fetch(url, {
    headers: headerAutenticazioneCardTrader(),
    muteHttpExceptions: true
  });

  if (risposta.getResponseCode() !== 200) {
    return { _error: 'HTTP ' + risposta.getResponseCode() };
  }

  try {
    var dati = JSON.parse(risposta.getContentText());
    // Alcuni endpoint CardTrader incapsulano i dati in { array: [...] }.
    return (dati && dati.array) ? dati.array : dati;
  } catch (errore) {
    return { _error: 'JSON non valido' };
  }
}


// ════════════════════════════════════════════════════════════════════
// SINCRONIZZAZIONE DEL CATALOGO
// ════════════════════════════════════════════════════════════════════
// Le funzioni Apps Script hanno un timeout di 6 minuti, ma scaricare
// centinaia di set può richiedere di più. Soluzione:
//
//   • La sync lavora set per set e dopo OGNI set salva nel CONFIG un
//     "cursore" (chiave 'sync_cursor') con l'ID dell'ultimo set elaborato.
//   • Allo scadere di 5 minuti (1 minuto di margine sul timeout) la
//     funzione si interrompe restituendo { partial: true }: il frontend
//     mostra "Ripremi per continuare" e l'utente rilancia la sync, che
//     riparte dal cursore salvato.
//   • Quando tutti i set sono stati elaborati, il cursore viene impostato
//     a 'DONE'.
//
// La sync è anche INCREMENTALE: i set già presenti in SET_CACHE vengono
// saltati, quindi rilanciarla scarica solo i set nuovi.
// ════════════════════════════════════════════════════════════════════

/**
 * Sincronizza il catalogo: scarica da CardTrader i set Pokémon (esclusa
 * la blacklist) e tutte le loro carte singole, salvandoli nei fogli
 * SET_CACHE e CACHE_CARDS.
 *
 * @returns {{success:boolean, partial?:boolean, message?:string,
 *            sets_done?:number, sets_total?:number, error?:string}}
 */
function syncCatalog(token) {
  try {
    requireAuth(token);

    var dataOraAdesso = formatDate(new Date());
    var istanteInizio = new Date().getTime();
    var LIMITE_TEMPO_MS = 5 * 60 * 1000; // 5 minuti (margine sul timeout GAS di 6)

    // ---- 1. Scarica la lista di TUTTE le espansioni da CardTrader ----
    var tutteLeEspansioni = chiamaCardTrader(URL_BASE_API_CARDTRADER + '/expansions');
    if (tutteLeEspansioni._error) {
      return { success: false, error: 'Errore espansioni: ' + tutteLeEspansioni._error };
    }

    // ---- 2. Filtra: solo Pokémon e non in blacklist ----
    var espansioniDaScaricare = tutteLeEspansioni.filter(function(espansione) {
      return espansione.game_id === ID_GIOCO_POKEMON_SU_CARDTRADER &&
             ID_ESPANSIONI_ESCLUSE.indexOf(espansione.id) === -1;
    });
    Logger.log('[SYNC] Set target dopo filtro: ' + espansioniDaScaricare.length);

    var foglioSet   = getSheet('SET_CACHE');
    var foglioCarte = getSheet('CACHE_CARDS');

    // ---- 3. Se i fogli sono completamente vuoti, scrivi le intestazioni ----
    if (foglioSet.getLastRow() === 0) {
      foglioSet.appendRow(['set_id','set_name','set_series','set_logo_url',
                           'release_date','total_cards','ct_expansion_id']);
    }
    if (foglioCarte.getLastRow() === 0) {
      foglioCarte.appendRow(['id','name','set_id','set_name','set_series','number',
                             'rarity','types','image_url_small','image_url_large',
                             'set_logo_url','last_updated','blueprint_id']);
    }

    // ---- 4. Sync incrementale: segna i set GIÀ in cache per saltarli ----
    var setGiaElaborati = {};
    var righeSetInCache = foglioSet.getDataRange().getValues();
    for (var r = 1; r < righeSetInCache.length; r++) { // r=1 salta l'intestazione
      if (righeSetInCache[r][0]) setGiaElaborati[Number(righeSetInCache[r][0])] = true;
    }

    // ---- 5. Riprendi dal cursore (in caso di sync precedente interrotta) ----
    var cursoreSalvato = getConfig('sync_cursor') || '';
    var idSetCursore   = (cursoreSalvato && cursoreSalvato !== 'DONE')
      ? parseInt(cursoreSalvato, 10)
      : 0;

    var indicePartenza = 0;
    if (idSetCursore > 0) {
      // Trova la posizione del set salvato nel cursore e riparti dal successivo.
      for (var k = 0; k < espansioniDaScaricare.length; k++) {
        if (espansioniDaScaricare[k].id === idSetCursore) {
          indicePartenza = k + 1;
          break;
        }
      }
    }

    var contatoreNuoviSet = 0;

    // ---- 6. Ciclo principale: un set alla volta ----
    for (var s = indicePartenza; s < espansioniDaScaricare.length; s++) {

      // Timeout in arrivo? Salva il cursore e restituisci "parziale".
      if (new Date().getTime() - istanteInizio > LIMITE_TEMPO_MS) {
        setConfig('sync_cursor', String(espansioniDaScaricare[s > 0 ? s - 1 : 0].id));
        setConfig('last_catalog_sync', dataOraAdesso + ' (parziale)');
        return {
          success: true,
          partial: true,
          message: 'Sync in corso: ' + s + '/' + espansioniDaScaricare.length +
                   ' set. Ripremi per continuare.',
          sets_done:  s,
          sets_total: espansioniDaScaricare.length
        };
      }

      var espansione = espansioniDaScaricare[s];
      if (setGiaElaborati[espansione.id]) continue; // già in cache: salta

      // ---- 6a. Scarica tutti i blueprint (prodotti) dell'espansione ----
      var blueprintDelSet = chiamaCardTrader(
        URL_BASE_API_CARDTRADER + '/blueprints/export?expansion_id=' + espansione.id
      );
      if (blueprintDelSet._error || !Array.isArray(blueprintDelSet)) {
        Logger.log('[SYNC] Skip ' + espansione.name + ': ' +
                   (blueprintDelSet._error || 'non array'));
        continue;
      }

      // ---- 6b. Tieni solo le carte singole (escludi buste, box, ecc.) ----
      var carteSingole = blueprintDelSet.filter(function(blueprint) {
        return blueprint.category_id === ID_CATEGORIA_CARTA_SINGOLA;
      });
      if (carteSingole.length === 0) {
        Logger.log('[SYNC] Skip ' + espansione.name + ': nessuna carta singola');
        continue;
      }

      // ---- 6c. Classifica il set come Giapponese (JP) o Internazionale (INT) ----
      // Guardiamo la proprietà 'pokemon_language' del PRIMO blueprint del set:
      // se il suo valore di default è 'jp' allora tutto il set è giapponese.
      var serieDelSet = 'INT';
      var proprietaModificabili = carteSingole[0].editable_properties || [];
      for (var p = 0; p < proprietaModificabili.length; p++) {
        if (proprietaModificabili[p].name === 'pokemon_language') {
          serieDelSet = proprietaModificabili[p].default_value === 'jp' ? 'JP' : 'INT';
          break;
        }
      }
      Logger.log('[SYNC] ' + espansione.name + ' → ' + serieDelSet +
                 ' (' + carteSingole.length + ' carte)');

      // ---- 6d. Per i set internazionali: recupera logo e data da GitHub ----
      var urlLogoSet = '';
      var dataUscita = '';
      if (serieDelSet === 'INT') {
        var datiGithub = getGithubSetsMap()[espansione.name.toLowerCase()];
        if (datiGithub) {
          urlLogoSet = datiGithub.logo;
          dataUscita = datiGithub.releaseDate;
        }
      }

      // ---- 6e. Scrivi la riga del set in SET_CACHE ----
      foglioSet.appendRow([
        String(espansione.id), espansione.name, serieDelSet,
        urlLogoSet, dataUscita, carteSingole.length, espansione.id
      ]);

      // ---- 6f. Prepara le righe delle carte e scrivile in un colpo solo ----
      // (scrivere in batch con setValues è MOLTO più veloce di appendRow per riga)
      var righeCarte = carteSingole.map(function(blueprint) {
        var numeroCollezione = (blueprint.fixed_properties &&
                                blueprint.fixed_properties.collector_number) || '';
        var rarita           = (blueprint.fixed_properties &&
                                blueprint.fixed_properties.pokemon_rarity) || '';

        // CardTrader può indicare anche una "versione" (es. Reverse Holo).
        // Componiamo la rarità mostrata come "Rarità · Variante" solo se la
        // variante aggiunge davvero informazione.
        var variante = (blueprint.version || '').split('|')[0].trim();
        var raritaDaMostrare =
          (variante && variante.toLowerCase() !== rarita.toLowerCase())
            ? (rarita ? rarita + ' · ' + variante : variante)
            : rarita;

        // ID interno della carta: "<idEspansione>_<idBlueprint>"
        // (così dal card_id si ricava sempre il set di appartenenza).
        var idCarta = String(espansione.id) + '_' + blueprint.id;

        // Ordine colonne = intestazione di CACHE_CARDS.
        return [
          idCarta,                       // id
          blueprint.name,                // name
          String(espansione.id),         // set_id
          espansione.name,               // set_name
          serieDelSet,                   // set_series (INT/JP)
          numeroCollezione,              // number
          raritaDaMostrare,              // rarity
          '',                            // types (non fornito da CardTrader)
          blueprint.image_url || '',     // image_url_small
          blueprint.image_url || '',     // image_url_large (stessa immagine)
          '',                            // set_logo_url (sta in SET_CACHE)
          dataOraAdesso,                 // last_updated
          blueprint.id                   // blueprint_id (serve per i prezzi)
        ];
      });

      if (righeCarte.length > 0) {
        foglioCarte
          .getRange(foglioCarte.getLastRow() + 1, 1, righeCarte.length, 13)
          .setValues(righeCarte);
      }

      // ---- 6g. Set completato: aggiorna stato e cursore ----
      setGiaElaborati[espansione.id] = true;
      contatoreNuoviSet++;
      setConfig('sync_cursor', String(espansione.id));
    }

    // ---- 7. Sync completata su tutti i set ----
    setConfig('sync_cursor', 'DONE');
    setConfig('last_catalog_sync', dataOraAdesso);

    return {
      success: true,
      partial: false,
      message: contatoreNuoviSet > 0
        ? 'Catalogo aggiornato: ' + contatoreNuoviSet + ' nuovi set aggiunti.'
        : 'Catalogo già aggiornato, nessun nuovo set trovato.',
      sets_total: espansioniDaScaricare.length
    };

  } catch (errore) {
    if (errore.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: 'Errore sync: ' + errore.message };
  }
}


// ════════════════════════════════════════════════════════════════════
// LETTURA DEL CATALOGO DALLA CACHE (funzioni chiamate dal frontend)
// ════════════════════════════════════════════════════════════════════
// Strategia "lazy loading": all'apertura del catalogo il frontend chiede
// SOLO la lista dei set (getSetList). Le carte di un set vengono caricate
// solo quando l'utente lo espande (getCardsForSet). Questo rende
// l'apertura della pagina molto più veloce.
// ════════════════════════════════════════════════════════════════════

/**
 * Restituisce la lista di tutti i set in cache (senza le carte).
 */
function getSetList(token) {
  try {
    requireAuth(token);

    var foglioSet  = getSheet('SET_CACHE');
    var ultimaRiga = foglioSet.getLastRow();
    if (ultimaRiga <= 1) return { success: true, sets: [], empty: true };

    var righe = foglioSet.getRange(1, 1, ultimaRiga, 7).getValues();
    var listaSet = [];

    for (var i = 1; i < righe.length; i++) { // i=1 salta l'intestazione
      var riga = righe[i];
      if (!riga[0]) continue; // salta righe vuote
      listaSet.push({
        set_id:          String(riga[0]),
        set_name:        String(riga[1] || ''),
        set_series:      String(riga[2] || ''),       // 'INT' o 'JP'
        set_logo_url:    String(riga[3] || ''),
        release_date:    String(riga[4] || ''),
        total_cards:     Number(riga[5] || 0),
        ct_expansion_id: Number(riga[6] || riga[0])
      });
    }

    return {
      success:   true,
      sets:      listaSet,
      empty:     listaSet.length === 0,
      last_sync: getConfig('last_catalog_sync')
    };
  } catch (errore) {
    if (errore.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: errore.message };
  }
}

/**
 * Restituisce tutte le carte di UN set.
 * Chiamata dal frontend quando l'utente espande l'intestazione di un set.
 */
function getCardsForSet(token, setId) {
  try {
    requireAuth(token);

    var foglioCarte = getSheet('CACHE_CARDS');
    var ultimaRiga  = foglioCarte.getLastRow();
    if (ultimaRiga <= 1) return { success: true, cards: [] };

    var righe       = foglioCarte.getRange(1, 1, ultimaRiga, 13).getValues();
    var carteDelSet = [];
    var idSetCercato = String(setId);

    for (var i = 1; i < righe.length; i++) {
      if (!righe[i][0]) continue;
      if (String(righe[i][2]) === idSetCercato) { // colonna 3 (indice 2) = set_id
        try { carteDelSet.push(convertiRigaInCarta(righe[i])); } catch (e) { continue; }
      }
    }

    return { success: true, cards: carteDelSet };
  } catch (errore) {
    if (errore.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: errore.message };
  }
}

/**
 * Restituisce le carte corrispondenti a una lista di ID.
 * Usata dalla sezione Portfolio per caricare in un colpo solo i metadati
 * (nome, immagine, set...) di tutte le carte possedute.
 */
function getCardsForIds(token, cardIds) {
  try {
    requireAuth(token);
    if (!cardIds || !cardIds.length) return { success: true, cards: [] };

    var foglioCarte = getSheet('CACHE_CARDS');
    var ultimaRiga  = foglioCarte.getLastRow();
    if (ultimaRiga <= 1) return { success: true, cards: [] };

    // Trasforma la lista di ID in un dizionario per ricerca veloce O(1).
    var idDaCercare = {};
    cardIds.forEach(function(id) { idDaCercare[String(id)] = true; });

    var righe = foglioCarte.getRange(1, 1, ultimaRiga, 13).getValues();
    var carteTrovate = [];

    for (var i = 1; i < righe.length; i++) {
      if (!righe[i][0]) continue;
      if (idDaCercare[String(righe[i][0])]) {
        try { carteTrovate.push(convertiRigaInCarta(righe[i])); } catch (e) { continue; }
      }
    }

    return { success: true, cards: carteTrovate };
  } catch (errore) {
    if (errore.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: errore.message };
  }
}

/**
 * Ricerca carte per nome (sottostringa, case-insensitive).
 * Usata dalla barra di ricerca del catalogo. Richiede almeno 2 caratteri.
 */
function searchCards(token, testoCercato) {
  try {
    requireAuth(token);
    if (!testoCercato || testoCercato.trim().length < 2) {
      return { success: true, cards: [] };
    }

    var foglioCarte = getSheet('CACHE_CARDS');
    var ultimaRiga  = foglioCarte.getLastRow();
    if (ultimaRiga <= 1) return { success: true, cards: [] };

    var righe     = foglioCarte.getRange(1, 1, ultimaRiga, 13).getValues();
    var query     = testoCercato.trim().toLowerCase();
    var risultati = [];

    for (var i = 1; i < righe.length; i++) {
      if (!righe[i][0]) continue;
      // colonna 2 (indice 1) = nome carta
      if (String(righe[i][1]).toLowerCase().indexOf(query) !== -1) {
        risultati.push(convertiRigaInCarta(righe[i]));
      }
    }

    return { success: true, cards: risultati };
  } catch (errore) {
    if (errore.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: errore.message };
  }
}

/**
 * Converte una riga "grezza" del foglio CACHE_CARDS in un oggetto carta
 * con campi nominati, pronto per essere inviato al frontend.
 *
 * Indici colonne (0-based):
 *   0=id  1=name  2=set_id  3=set_name  4=set_series  5=number  6=rarity
 *   7=types  8=image_url_small  9=image_url_large  10=set_logo_url
 *   11=last_updated  12=blueprint_id
 */
function convertiRigaInCarta(riga) {
  return {
    id:              String(riga[0]),
    name:            String(riga[1]  || ''),
    set_id:          String(riga[2]  || ''),
    set_name:        String(riga[3]  || ''),
    set_series:      String(riga[4]  || ''),
    number:          String(riga[5]  || ''),
    rarity:          String(riga[6]  || ''),
    types:           String(riga[7]  || ''),
    image_url_small: String(riga[8]  || ''),
    image_url_large: String(riga[9]  || ''),
    set_logo_url:    String(riga[10] || ''),
    blueprint_id:    riga[12] ? Number(riga[12]) : null,
    is_jp:           String(riga[4] || '') === 'JP' // comodo flag per il frontend
  };
}
