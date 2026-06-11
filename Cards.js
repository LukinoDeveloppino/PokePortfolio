// ============================================================
// Cards.gs — Catalogo da CardTrader API
// Classificazione JP/INT automatica, aggiornamento automatico
// ============================================================

var CT_BASE = 'https://api.cardtrader.com/api/v2';
var POKEMON_GAME_ID_CT = 5;
var SINGLE_CARD_CAT = 73;

// Blacklist espansioni da escludere (set vecchi, prodotti sealed, deck kit, ecc.)
// Tutto ciò che NON è in blacklist viene incluso automaticamente — anche i nuovi set futuri.
var BLACKLIST_EXPANSION_IDS = [
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
  4644,4645,4655,4656,4657,4669
];

// Cache loghi GitHub — scaricata una volta per sync
var _githubSetsCache = null;

function getGithubSetsMap() {
  if (_githubSetsCache) return _githubSetsCache;
  try {
    var resp = UrlFetchApp.fetch(
      'https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/sets/en.json',
      { muteHttpExceptions: true }
    );
    if (resp.getResponseCode() !== 200) return {};
    var sets = JSON.parse(resp.getContentText());
    var map = {};
    sets.forEach(function(s) {
      map[s.name.toLowerCase()] = {
        logo: (s.images && s.images.logo) ? s.images.logo : '',
        releaseDate: s.releaseDate || ''
      };
    });
    _githubSetsCache = map;
    return map;
  } catch(e) {
    return {};
  }
}

// ---- Helper ----

function ctHeaders() {
  return { 'Authorization': 'Bearer ' + getConfig('cardtrader_api_key') };
}

function ctFetch(url) {
  var resp = UrlFetchApp.fetch(url, { headers: ctHeaders(), muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) return { _error: 'HTTP ' + resp.getResponseCode() };
  try {
    var d = JSON.parse(resp.getContentText());
    return (d && d.array) ? d.array : d;
  } catch(e) { return { _error: 'JSON non valido' }; }
}

// Classifica JP/INT dal primo blueprint della singola carta
// Ritorna 'JP', 'INT', o null (nessuna carta singola = salta)
function classifyExpansion(expansionId) {
  var bps = ctFetch(CT_BASE + '/blueprints/export?expansion_id=' + expansionId);
  if (bps._error || !Array.isArray(bps)) return null;
  var singles = bps.filter(function(bp) { return bp.category_id === SINGLE_CARD_CAT; });
  if (singles.length === 0) return null;
  // Cerca default_value di pokemon_language nel primo blueprint
  var bp = singles[0];
  var props = bp.editable_properties || [];
  for (var i = 0; i < props.length; i++) {
    if (props[i].name === 'pokemon_language') {
      return props[i].default_value === 'jp' ? 'JP' : 'INT';
    }
  }
  return 'INT'; // default internazionale se non specificato
}

function debugExpansionStructure() {
  var apiKey = getConfig('cardtrader_api_key');
  var headers = { 'Authorization': 'Bearer ' + apiKey };
  var resp = UrlFetchApp.fetch('https://api.cardtrader.com/api/v2/expansions', {
    headers: headers, muteHttpExceptions: true
  });
  var raw = JSON.parse(resp.getContentText());
  var expansions = (raw && raw.array) ? raw.array : raw;
  // Logga struttura completa di 3 espansioni Pokémon note
  var targets = [4079, 3878, 4188]; // Destined Rivals, Surging Sparks, Black Bolt JP
  expansions.filter(function(e) { return targets.indexOf(e.id) !== -1; }).forEach(function(e) {
    Logger.log('[DEBUG] ' + JSON.stringify(e));
  });
}
// Fase 1: scarica metadati set + classifica JP/INT + scarica carte
// Usa cursore per riprendere dopo timeout

function syncCatalog(token) {
  try {
    requireAuth(token);
    var now = formatDate(new Date());
    var startTime = new Date().getTime();
    var TIME_LIMIT = 5 * 60 * 1000;

    // Scarica tutte le espansioni Pokémon
    var allExps = ctFetch(CT_BASE + '/expansions');
    if (allExps._error) return { success: false, error: 'Errore espansioni: ' + allExps._error };

    // Filtra: solo Pokémon, escludi blacklist
    // I nuovi set futuri vengono inclusi automaticamente se non in blacklist
    var targetExps = allExps.filter(function(e) {
      return e.game_id === POKEMON_GAME_ID_CT &&
             BLACKLIST_EXPANSION_IDS.indexOf(e.id) === -1;
    });

    Logger.log('[SYNC] Set target dopo filtro: ' + targetExps.length);

    var setSheet  = getSheet('SET_CACHE');
    var cardSheet = getSheet('CACHE_CARDS');

    // Inizializza fogli se vuoti
    if (setSheet.getLastRow() === 0) {
      setSheet.appendRow(['set_id','set_name','set_series','set_logo_url','release_date','total_cards','ct_expansion_id']);
    }
    if (cardSheet.getLastRow() === 0) {
      cardSheet.appendRow(['id','name','set_id','set_name','set_series','number','rarity','types',
                           'image_url_small','image_url_large','set_logo_url','last_updated','blueprint_id']);
    }

    // Leggi set già in cache — sync incrementale, salta quelli già presenti
    var processedIds = {};
    var setData = setSheet.getDataRange().getValues();
    for (var r = 1; r < setData.length; r++) {
      if (setData[r][0]) processedIds[Number(setData[r][0])] = true;
    }

    // Leggi cursore per gestire timeout (riprende dal punto in cui si era fermato)
    var cursorRaw = getConfig('sync_cursor') || '';
    var cursorId  = (cursorRaw && cursorRaw !== 'DONE') ? parseInt(cursorRaw, 10) : 0;
    var startIdx  = 0;
    if (cursorId > 0) {
      for (var k = 0; k < targetExps.length; k++) {
        if (targetExps[k].id === cursorId) { startIdx = k + 1; break; }
      }
    }

    for (var s = startIdx; s < targetExps.length; s++) {
      // Timeout check
      if (new Date().getTime() - startTime > TIME_LIMIT) {
        setConfig('sync_cursor', String(targetExps[s > 0 ? s - 1 : 0].id));
        setConfig('last_catalog_sync', now + ' (parziale)');
        return {
          success: true, partial: true,
          message: 'Sync in corso: ' + s + '/' + targetExps.length + ' set. Ripremi per continuare.',
          sets_done: s, sets_total: targetExps.length
        };
      }

      var exp = targetExps[s];
      if (processedIds[exp.id]) continue;

      // Classifica e scarica carte
      var bps = ctFetch(CT_BASE + '/blueprints/export?expansion_id=' + exp.id);
      if (bps._error || !Array.isArray(bps)) {
        Logger.log('[SYNC] Skip ' + exp.name + ': ' + (bps._error || 'non array'));
        continue;
      }

      var singles = bps.filter(function(bp) { return bp.category_id === SINGLE_CARD_CAT; });
      if (singles.length === 0) {
        Logger.log('[SYNC] Skip ' + exp.name + ': nessuna carta singola');
        continue;
      }

      // Classifica dalla lingua del primo blueprint
      var series = 'INT';
      var props = singles[0].editable_properties || [];
      for (var p = 0; p < props.length; p++) {
        if (props[p].name === 'pokemon_language') {
          series = props[p].default_value === 'jp' ? 'JP' : 'INT';
          break;
        }
      }

      Logger.log('[SYNC] ' + exp.name + ' → ' + series + ' (' + singles.length + ' carte)');

      // Cerca logo e releaseDate su GitHub (solo per set INT)
      var logoUrl = '';
      var releaseDate = '';
      if (series === 'INT') {
        var ghMap = getGithubSetsMap();
        var ghData = ghMap[exp.name.toLowerCase()];
        if (ghData) {
          logoUrl = ghData.logo;
          releaseDate = ghData.releaseDate;
        }
      }

      // Scrivi set in SET_CACHE
      setSheet.appendRow([String(exp.id), exp.name, series, logoUrl, releaseDate, singles.length, exp.id]);

      // Scrivi carte in CACHE_CARDS
      var cardRows = singles.map(function(bp) {
        var num     = (bp.fixed_properties && bp.fixed_properties.collector_number) || '';
        var rarity  = (bp.fixed_properties && bp.fixed_properties.pokemon_rarity)  || '';
        var version = bp.version || '';
        var variant = version.split('|')[0].trim();
        var displayRarity = (variant && variant.toLowerCase() !== rarity.toLowerCase() && variant !== '')
          ? (rarity ? rarity + ' · ' + variant : variant)
          : rarity;
        var imgUrl = bp.image_url || '';
        var cardId = String(exp.id) + '_' + bp.id;
        return [cardId, bp.name, String(exp.id), exp.name, series,
                num, displayRarity, '', imgUrl, imgUrl, '', now, bp.id];
      });

      if (cardRows.length > 0) {
        cardSheet.getRange(cardSheet.getLastRow() + 1, 1, cardRows.length, 13).setValues(cardRows);
      }

      processedIds[exp.id] = true;
      setConfig('sync_cursor', String(exp.id));
    }

    setConfig('sync_cursor', 'DONE');
    setConfig('last_catalog_sync', now);

    var newSets = 0;
    var finalSetData = setSheet.getDataRange().getValues();
    newSets = finalSetData.length - 1 - Object.keys(processedIds).length;

    return {
      success: true, partial: false,
      message: newSets > 0
        ? 'Catalogo aggiornato: ' + newSets + ' nuovi set aggiunti.'
        : 'Catalogo già aggiornato, nessun nuovo set trovato.',
      sets_total: targetExps.length
    };

  } catch(e) {
    if (e.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: 'Errore sync: ' + e.message };
  }
}

// ---- Lettura solo lista set (per lazy loading) ----

function getSetList(token) {
  try {
    requireAuth(token);
    var setSheet = getSheet('SET_CACHE');
    var lastRow  = setSheet.getLastRow();
    if (lastRow <= 1) return { success: true, sets: [], empty: true };

    var setData = setSheet.getRange(1, 1, lastRow, 7).getValues();
    var sets = [];
    for (var j = 1; j < setData.length; j++) {
      var r = setData[j];
      if (!r[0]) continue;
      sets.push({
        set_id:          String(r[0]),
        set_name:        String(r[1] || ''),
        set_series:      String(r[2] || ''),
        set_logo_url:    String(r[3] || ''),
        release_date:    String(r[4] || ''),
        total_cards:     Number(r[5] || 0),
        ct_expansion_id: Number(r[6] || r[0])
      });
    }
    return {
      success: true, sets: sets, empty: sets.length === 0,
      last_sync: getConfig('last_catalog_sync')
    };
  } catch(e) {
    if (e.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: e.message };
  }
}

// ---- Lettura carte di un singolo set (per lazy loading catalogo) ----

function getCardsForSet(token, setId) {
  try {
    requireAuth(token);
    var cardSheet = getSheet('CACHE_CARDS');
    var lastRow   = cardSheet.getLastRow();
    if (lastRow <= 1) return { success: true, cards: [] };

    var data  = cardSheet.getRange(1, 1, lastRow, 13).getValues();
    var cards = [];
    var sid   = String(setId);
    for (var i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      if (String(data[i][2]) === sid) {
        try { cards.push(rowToCard(data[i])); } catch(e) { continue; }
      }
    }
    return { success: true, cards: cards };
  } catch(e) {
    if (e.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: e.message };
  }
}

// ---- Recupera carte per lista di ID (usata dal portfolio al caricamento) ----

function getCardsForIds(token, cardIds) {
  try {
    requireAuth(token);
    if (!cardIds || !cardIds.length) return { success: true, cards: [] };
    var sheet   = getSheet('CACHE_CARDS');
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return { success: true, cards: [] };

    var idSet = {};
    cardIds.forEach(function(id) { idSet[String(id)] = true; });

    var data  = sheet.getRange(1, 1, lastRow, 13).getValues();
    var cards = [];
    for (var i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      if (idSet[String(data[i][0])]) {
        try { cards.push(rowToCard(data[i])); } catch(e) { continue; }
      }
    }
    return { success: true, cards: cards };
  } catch(e) {
    if (e.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: e.message };
  }
}

// ---- Lettura catalogo dalla cache ----

function getCatalog(token) {
  try {
    requireAuth(token);
    var cardSheet = getSheet('CACHE_CARDS');
    var setSheet  = getSheet('SET_CACHE');
    var lastRow   = cardSheet.getLastRow();

    if (lastRow <= 1) return { success: true, cards: [], sets: [], empty: true };

    var cardData = cardSheet.getRange(1, 1, lastRow, 13).getValues();
    var setData  = setSheet.getDataRange().getValues();

    var cards = [];
    for (var i = 1; i < cardData.length; i++) {
      if (!cardData[i][0]) continue;
      try { cards.push(rowToCard(cardData[i])); } catch(e) { continue; }
    }

    var sets = [];
    for (var j = 1; j < setData.length; j++) {
      var r = setData[j];
      if (!r[0]) continue;
      sets.push({
        set_id:          String(r[0]),
        set_name:        String(r[1] || ''),
        set_series:      String(r[2] || ''),
        set_logo_url:    String(r[3] || ''),
        release_date:    String(r[4] || ''),
        total_cards:     Number(r[5] || 0),
        ct_expansion_id: Number(r[6] || r[0])
      });
    }

    if (cards.length === 0) return { success: true, cards: [], sets: [], empty: true };

    return {
      success: true, cards: cards, sets: sets,
      last_sync: getConfig('last_catalog_sync'), empty: false
    };
  } catch(e) {
    if (e.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: e.message };
  }
}

function rowToCard(row) {
  return {
    id:              String(row[0]),
    name:            String(row[1] || ''),
    set_id:          String(row[2] || ''),
    set_name:        String(row[3] || ''),
    set_series:      String(row[4] || ''),
    number:          String(row[5] || ''),
    rarity:          String(row[6] || ''),
    types:           String(row[7] || ''),
    image_url_small: String(row[8] || ''),
    image_url_large: String(row[9] || ''),
    set_logo_url:    String(row[10] || ''),
    blueprint_id:    row[12] ? Number(row[12]) : null,
    is_jp:           String(row[4] || '') === 'JP'
  };
}

// ---- Ricerca per nome ----

function searchCards(token, query) {
  try {
    requireAuth(token);
    if (!query || query.trim().length < 2) return { success: true, cards: [] };
    var sheet   = getSheet('CACHE_CARDS');
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return { success: true, cards: [] };
    var data    = sheet.getRange(1, 1, lastRow, 13).getValues();
    var q       = query.trim().toLowerCase();
    var results = [];
    for (var i = 1; i < data.length; i++) {
      if (!data[i][0]) continue;
      if (String(data[i][1]).toLowerCase().indexOf(q) !== -1) results.push(rowToCard(data[i]));
    }
    return { success: true, cards: results };
  } catch(e) {
    if (e.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: e.message };
  }
}

// ---- Recupera singola carta dalla cache ----

function getCardById(token, cardId) {
  try {
    requireAuth(token);
    var sheet   = getSheet('CACHE_CARDS');
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return { success: false, error: 'Cache vuota.' };
    var data    = sheet.getRange(1, 1, lastRow, 13).getValues();
    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(cardId)) return { success: true, card: rowToCard(data[i]) };
    }
    return { success: false, error: 'Carta non trovata.' };
  } catch(e) {
    if (e.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: e.message };
  }
}
