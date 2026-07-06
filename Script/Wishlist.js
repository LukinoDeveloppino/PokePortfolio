// ════════════════════════════════════════════════════════════════════
// Wishlist.gs — GESTIONE DELLA LISTA DEI DESIDERI
//               (lettura, aggiunta, modifica quantità, eliminazione)
// ════════════════════════════════════════════════════════════════════
// La lista dei desideri è concettualmente un "portfolio delle carte che
// vorrei": stesse colonne del foglio PORTFOLIO ma su un foglio dedicato
// (WISHLIST), così il batch prezzi e lo storico possono trattarla con la
// stessa identica logica. A differenza del portfolio NON contribuisce al
// valore totale della collezione e non ha statistiche/grafico aggregato.
//
// Colonne del foglio WISHLIST (1-based):
//   1 wishlist_id    UUID univoco della voce
//   2 card_id        riferimento id in CACHE_CARDS
//   3 quantity       numero di copie desiderate (di norma 1)
//   4 condition      Near Mint / Lightly Played / …
//   5 language       ITA / ENG / JPN / …
//   6 finish         Normal / Reverse Holo / Holofoil / Special
//   7 date_added     data di aggiunta
//   8 blueprint_id   id CardTrader (per i prezzi)
//   9 last_price     ultimo prezzo noto in € (dal batch o dal real-time)
// ════════════════════════════════════════════════════════════════════

function convertiRigaInVoceWishlist(riga) {
  return {
    wishlist_id:  String(riga[0]),
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

// Cerca una voce per wishlistId nel foglio WISHLIST.
// Restituisce { foglio, righe, indice } dove indice è 0-based in righe
// (la riga reale nel foglio è indice+1), oppure null se non trovata.
function _trovaRigaWishlist(wishlistId) {
  var foglio = getSheet('WISHLIST');
  var righe  = foglio.getDataRange().getValues();
  for (var i = 1; i < righe.length; i++) {
    if (String(righe[i][0]) === String(wishlistId)) {
      return { foglio: foglio, righe: righe, indice: i };
    }
  }
  return null;
}


// ════════════════════════════════════════════════════════════════════
// LETTURA
// ════════════════════════════════════════════════════════════════════

function getWishlist(token) {
  return _wrapApiCall(function() {
    requireAuth(token);

    var foglio     = getSheet('WISHLIST');
    var ultimaRiga = foglio.getLastRow();
    if (ultimaRiga <= 1) return { success: true, items: [] };

    var righe          = foglio.getRange(1, 1, ultimaRiga, 9).getValues();
    var rigaDiPartenza = _primaRigaDati(righe, 'wishlist_id');
    var voci = [];
    for (var i = rigaDiPartenza; i < righe.length; i++) {
      if (!righe[i][0]) continue;
      voci.push(convertiRigaInVoceWishlist(righe[i]));
    }

    return { success: true, items: voci };
  });
}


// ════════════════════════════════════════════════════════════════════
// AGGIUNTA
// ════════════════════════════════════════════════════════════════════

function addToWishlist(token, cardId, quantity, condition, language, finish, blueprintId) {
  return _wrapApiCall(function() {
    requireAuth(token);

    if (!cardId || !quantity || !condition || !language || !finish) {
      return { success: false, error: 'Tutti i campi sono obbligatori.' };
    }

    var nuovoId = Utilities.getUuid();

    getSheet('WISHLIST').appendRow([
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

    return { success: true, wishlist_id: nuovoId };
  });
}


// ════════════════════════════════════════════════════════════════════
// MODIFICA QUANTITÀ
// ════════════════════════════════════════════════════════════════════

function incrementWishlistItem(token, wishlistId, delta) {
  return _wrapApiCall(function() {
    requireAuth(token);

    var trovato = _trovaRigaWishlist(wishlistId);
    if (!trovato) return { success: false, error: 'Voce non trovata.' };

    var nuovaQuantita = parseInt(trovato.righe[trovato.indice][2], 10) + parseInt(delta, 10);
    if (nuovaQuantita <= 0) {
      return { success: false, error: 'Usa deleteWishlistItem per rimuovere la voce.' };
    }

    trovato.foglio.getRange(trovato.indice + 1, 3).setValue(nuovaQuantita);
    return { success: true, new_quantity: nuovaQuantita };
  });
}


// ════════════════════════════════════════════════════════════════════
// ELIMINAZIONE
// ════════════════════════════════════════════════════════════════════

function deleteWishlistItem(token, wishlistId) {
  return _wrapApiCall(function() {
    requireAuth(token);

    var trovato = _trovaRigaWishlist(wishlistId);
    if (!trovato) return { success: false, error: 'Voce non trovata.' };

    trovato.foglio.deleteRow(trovato.indice + 1);
    return { success: true };
  });
}
