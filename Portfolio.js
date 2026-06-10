// ============================================================
// Portfolio.gs — CRUD sul foglio PORTFOLIO
// ============================================================

// ---- Lettura portfolio completo ----

function getPortfolio(token) {
  try {
    requireAuth(token);
    var sheet = getSheet('PORTFOLIO');
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return { success: true, items: [] };

    var data = sheet.getRange(1, 1, lastRow, 9).getValues();

    // Controlla se la prima riga è intestazione o già un dato
    var startRow = (data[0][0] === 'portfolio_id') ? 1 : 0;

    var items = [];
    for (var i = startRow; i < data.length; i++) {
      var row = data[i];
      if (!row[0]) continue;
      items.push({
        portfolio_id: String(row[0]),
        card_id:      String(row[1]),
        quantity:     Number(row[2]),
        condition:    String(row[3]),
        language:     String(row[4]),
        finish:       String(row[5]),
        date_added:   String(row[6]),
        blueprint_id: row[7] ? Number(row[7]) : null,
        last_price:   row[8] !== '' && row[8] !== null && row[8] !== undefined ? Number(row[8]) : null
      });
    }

    return { success: true, items: items };
  } catch (e) {
    if (e.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: e.message };
  }
}

// ---- Aggiunge nuova voce al portfolio ----

function addToPortfolio(token, cardId, quantity, condition, language, finish, blueprintId) {
  try {
    requireAuth(token);

    if (!cardId || !quantity || !condition || !language || !finish) {
      return { success: false, error: 'Tutti i campi sono obbligatori.' };
    }

    var sheet = getSheet('PORTFOLIO');
    var id = generateUuid();
    var now = formatDate(new Date());

    sheet.appendRow([id, cardId, quantity, condition, language, finish, now, blueprintId || '', '']);

    return { success: true, portfolio_id: id };
  } catch (e) {
    if (e.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: e.message };
  }
}

// ---- Incrementa quantità di una voce esistente ----

function incrementPortfolioItem(token, portfolioId, delta) {
  try {
    requireAuth(token);
    var sheet = getSheet('PORTFOLIO');
    var data = sheet.getDataRange().getValues();

    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === portfolioId) {
        var newQty = parseInt(data[i][2], 10) + parseInt(delta, 10);
        if (newQty <= 0) {
          return { success: false, error: 'Usa deletePortfolioItem per rimuovere la voce.' };
        }
        sheet.getRange(i + 1, 3).setValue(newQty);
        return { success: true, new_quantity: newQty };
      }
    }

    return { success: false, error: 'Voce non trovata.' };
  } catch (e) {
    if (e.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: e.message };
  }
}

// ---- Aggiorna quantità di una voce ----

function updatePortfolioQuantity(token, portfolioId, newQuantity) {
  try {
    requireAuth(token);
    var sheet = getSheet('PORTFOLIO');
    var data = sheet.getDataRange().getValues();

    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === portfolioId) {
        sheet.getRange(i + 1, 3).setValue(newQuantity);
        return { success: true };
      }
    }

    return { success: false, error: 'Voce non trovata.' };
  } catch (e) {
    if (e.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: e.message };
  }
}

// ---- Elimina una voce dal portfolio ----

function deletePortfolioItem(token, portfolioId) {
  try {
    requireAuth(token);
    var sheet = getSheet('PORTFOLIO');
    var data = sheet.getDataRange().getValues();

    for (var i = 1; i < data.length; i++) {
      if (data[i][0] === portfolioId) {
        sheet.deleteRow(i + 1);
        return { success: true };
      }
    }

    return { success: false, error: 'Voce non trovata.' };
  } catch (e) {
    if (e.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: e.message };
  }
}

// ---- Salva last_price per una singola voce ----

function saveLastPrice(token, portfolioId, price) {
  try {
    requireAuth(token);
    var sheet = getSheet('PORTFOLIO');
    var data = sheet.getDataRange().getValues();

    for (var i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(portfolioId)) {
        sheet.getRange(i + 1, 9).setValue(price !== null ? price : '');
        return { success: true };
      }
    }

    return { success: false, error: 'Voce non trovata.' };
  } catch (e) {
    if (e.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: e.message };
  }
}

// ---- Export CSV portfolio ----
// Ritorna al frontend i dati grezzi; il CSV viene generato lato client

function exportPortfolioData(token) {
  try {
    requireAuth(token);
    var portfolioResult = getPortfolio(token);
    if (!portfolioResult.success) return portfolioResult;

    var items = portfolioResult.items;
    if (items.length === 0) return { success: true, rows: [] };

    // Arricchisce con dati carta dalla cache
    var cardSheet = getSheet('CACHE_CARDS');
    var cardData = cardSheet.getDataRange().getValues();
    var cardMap = {};
    for (var i = 1; i < cardData.length; i++) {
      var row = cardData[i];
      if (row[0]) cardMap[row[0]] = { name: row[1], set_name: row[3], number: row[5] };
    }

    var rows = items.map(function(item) {
      var card = cardMap[item.card_id] || { name: item.card_id, set_name: '', number: '' };
      return {
        nome_carta: card.name,
        set: card.set_name,
        numero: card.number,
        condizione: item.condition,
        lingua: item.language,
        finitura: item.finish,
        quantita: item.quantity,
        data_aggiunta: item.date_added,
        last_price: item.last_price !== null ? item.last_price : ''
      };
    });

    return { success: true, rows: rows };
  } catch (e) {
    if (e.message === 'UNAUTHORIZED') return { success: false, error: 'UNAUTHORIZED' };
    return { success: false, error: e.message };
  }
}
