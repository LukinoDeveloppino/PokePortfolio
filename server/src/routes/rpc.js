// ════════════════════════════════════════════════════════════════════
// rpc.js — LE FUNZIONI "google.script.run" COME API HTTP
// ════════════════════════════════════════════════════════════════════
// POST /api/rpc/<nomeFunzione> con corpo JSON = array degli argomenti,
// nello stesso ordine della versione GAS (token di sessione compreso).
// Così il frontend continua a chiamare le stesse funzioni con gli stessi
// argomenti, e public/gas-shim.js traduce google.script.run in fetch.
//
// Solo le funzioni elencate qui sono raggiungibili dal browser.
// ════════════════════════════════════════════════════════════════════

import { ErroreApi, NonAutorizzato } from '../lib/errori.js';
import * as auth from '../services/auth.js';
import * as catalogo from '../services/catalog.js';
import * as collezione from '../services/collection.js';
import * as prezzi from '../services/prices.js';
import * as amici from '../services/friends.js';

// Ogni gestore riceve (contesto, ...argomenti). Per le funzioni con
// `autenticata: true` il primo argomento (il token) viene consumato qui e
// contesto.utente è l'utente collegato; contesto.log è il logger della
// richiesta.
const FUNZIONI = {
  // ---- Sessione ----
  login:        { gestore: (_, username, password) => auth.login(username, password) },
  register:     { gestore: (_, username, password, apiKey) => auth.register(username, password, apiKey) },
  logout:       { gestore: (_, token) => auth.logout(token) },
  checkSession: { gestore: (_, token) => auth.checkSession(token) },

  // ---- Catalogo ----
  getSetList:           { autenticata: true, gestore: ({ utente: u }) => catalogo.getSetList(u.id) },
  getCardsForSet:       { autenticata: true, gestore: (_, idSet) => catalogo.getCardsForSet(idSet) },
  getCardsForIds:       { autenticata: true, gestore: (_, idCarte) => catalogo.getCardsForIds(idCarte) },
  searchCards:          { autenticata: true, gestore: (_, testo) => catalogo.searchCards(testo) },
  setSetHidden:         { autenticata: true, gestore: ({ utente: u }, idSet, nascondi) => catalogo.setSetHidden(u.id, idSet, nascondi) },
  refreshSet:           { autenticata: true, gestore: (_, idSet) => catalogo.refreshSet(idSet) },
  getCatalogSyncStatus: { autenticata: true, gestore: () => catalogo.getCatalogSyncStatus() },
  startRefreshAllSets:  {
    autenticata: true,
    gestore: async ({ log }) => {
      const { avviato } = await catalogo.avviaSyncCatalogo({ mode: 'refresh', log });
      if (!avviato) throw new ErroreApi('Sincronizzazione del catalogo già in corso.');
      return { success: true };
    }
  },

  // ---- Portfolio ----
  getPortfolio:           { autenticata: true, gestore: ({ utente: u }) => collezione.getLista(u.id, 'portfolio') },
  addToPortfolio:         { autenticata: true, gestore: ({ utente: u }, ...a) => collezione.aggiungiVoce(u.id, 'portfolio', voceDaArgomenti(a)) },
  incrementPortfolioItem: { autenticata: true, gestore: ({ utente: u }, id, delta) => collezione.incrementaVoce(u.id, 'portfolio', id, delta) },
  deletePortfolioItem:    { autenticata: true, gestore: ({ utente: u }, id) => collezione.eliminaVoce(u.id, 'portfolio', id) },
  exportPortfolioData:    { autenticata: true, gestore: ({ utente: u }) => collezione.exportPortfolioData(u.id) },
  getDashboardData:       { autenticata: true, gestore: ({ utente: u }) => collezione.getDashboardData(u.id) },
  getPriceHistory:        { autenticata: true, gestore: ({ utente: u }) => collezione.getPriceHistory(u.id) },
  getCardsPriceHistory:   { autenticata: true, gestore: ({ utente: u }) => collezione.getStoricoVoci(u.id, 'portfolio') },

  // ---- Lista dei desideri ----
  getWishlist:                  { autenticata: true, gestore: ({ utente: u }) => collezione.getLista(u.id, 'wishlist') },
  addToWishlist:                { autenticata: true, gestore: ({ utente: u }, ...a) => collezione.aggiungiVoce(u.id, 'wishlist', voceDaArgomenti(a)) },
  incrementWishlistItem:        { autenticata: true, gestore: ({ utente: u }, id, delta) => collezione.incrementaVoce(u.id, 'wishlist', id, delta) },
  deleteWishlistItem:           { autenticata: true, gestore: ({ utente: u }, id) => collezione.eliminaVoce(u.id, 'wishlist', id) },
  getWishlistCardsPriceHistory: { autenticata: true, gestore: ({ utente: u }) => collezione.getStoricoVoci(u.id, 'wishlist') },

  // ---- Prezzi (in GAS rispondevano con `message` invece di `error`) ----
  getPriceForVariant:         { autenticata: true, rispostaPrezzo: true, gestore: ({ utente: u }, ...a) => prezzi.getPrezzoPerVariante(u, 'portfolio', varianteDaArgomenti(a)) },
  getWishlistPriceForVariant: { autenticata: true, rispostaPrezzo: true, gestore: ({ utente: u }, ...a) => prezzi.getPrezzoPerVariante(u, 'wishlist', varianteDaArgomenti(a)) },

  // ---- Amici ----
  getFriends:         { autenticata: true, gestore: ({ utente: u }) => amici.getFriends(u.id) },
  getFriendPortfolio: { autenticata: true, gestore: (_, idAmico) => amici.getFriendPortfolio(idAmico) }
};

// (cardId, quantity, condition, language, finish, blueprintId)
function voceDaArgomenti([cardId, quantity, condition, language, finish, blueprintId]) {
  return { cardId, quantity, condition, language, finish, blueprintId };
}

// (cardId, condition, language, finish, blueprintId)
function varianteDaArgomenti([cardId, condition, language, finish, blueprintId]) {
  return { cardId, condition, language, finish, blueprintId };
}

export async function rottaRpc(app) {
  app.post('/api/rpc/:funzione', {
    schema: { body: { type: 'array', maxItems: 20 } }
  }, async (request) => {
    const definizione = Object.hasOwn(FUNZIONI, request.params.funzione)
      ? FUNZIONI[request.params.funzione] : null;
    if (!definizione) {
      return { success: false, error: 'Funzione sconosciuta: ' + request.params.funzione };
    }

    const argomenti = request.body || [];
    try {
      if (!definizione.autenticata) return await definizione.gestore({ log: request.log }, ...argomenti);

      const [token, ...resto] = argomenti;
      const utente = await auth.richiediUtente(token);
      return await definizione.gestore({ utente, log: request.log }, ...resto);

    } catch (errore) {
      const previsto = errore instanceof ErroreApi;
      if (!previsto) request.log.error(errore, `Errore in ${request.params.funzione}`);

      if (definizione.rispostaPrezzo) {
        return {
          success: false,
          price:   null,
          message: errore instanceof NonAutorizzato ? 'UNAUTHORIZED' : 'Servizio non disponibile.'
        };
      }
      return { success: false, error: previsto ? errore.message : 'Errore interno del server.' };
    }
  });
}
