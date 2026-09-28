// ════════════════════════════════════════════════════════════════════
// cardtrader.js — CLIENT HTTP PER L'API CARDTRADER
// ════════════════════════════════════════════════════════════════════
// Terminologia CardTrader:
//   • "expansion" = set di carte (es. "Scarlet & Violet 151")
//   • "blueprint" = singola carta/prodotto dentro un set
// ════════════════════════════════════════════════════════════════════

export const URL_BASE_API_CARDTRADER = 'https://api.cardtrader.com/api/v2';
export const ID_GIOCO_POKEMON = 5;
export const ID_CATEGORIA_CARTA_SINGOLA = 73;

const TENTATIVI_MASSIMI = 3;
const TIMEOUT_MS = 30_000;

export class ErroreCardTrader extends Error {
  constructor(messaggio, stato) {
    super(messaggio);
    this.name = 'ErroreCardTrader';
    this.stato = stato;
  }
}

export const attendi = (ms) => new Promise((risolvi) => setTimeout(risolvi, ms));

// GET su un percorso dell'API (es. '/expansions'). Restituisce il JSON
// già estratto da { array: [...] } quando CardTrader lo avvolge così.
// Riprova da solo su 429 (rate limit) ed errori 5xx o di rete.
export async function chiamaCardTrader(percorso, apiKey) {
  let ultimoErrore;

  for (let tentativo = 1; tentativo <= TENTATIVI_MASSIMI; tentativo++) {
    let risposta;
    try {
      risposta = await fetch(URL_BASE_API_CARDTRADER + percorso, {
        headers: { Authorization: 'Bearer ' + (apiKey || '') },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
    } catch (errore) {
      ultimoErrore = new ErroreCardTrader('Rete: ' + errore.message, null);
      await attendi(1000 * tentativo);
      continue;
    }

    if (risposta.ok) {
      let dati;
      try {
        dati = await risposta.json();
      } catch {
        throw new ErroreCardTrader('JSON non valido', risposta.status);
      }
      return (dati && dati.array) ? dati.array : dati;
    }

    ultimoErrore = new ErroreCardTrader('HTTP ' + risposta.status, risposta.status);
    const riprovabile = risposta.status === 429 || risposta.status >= 500;
    if (!riprovabile) throw ultimoErrore;

    const attesaSuggerita = Number(risposta.headers.get('retry-after')) * 1000;
    await attendi(attesaSuggerita || 2000 * tentativo);
  }

  throw ultimoErrore;
}

// 'valida' | 'non_valida' | 'sconosciuto' (CardTrader irraggiungibile).
export async function verificaApiKey(apiKey) {
  try {
    await chiamaCardTrader('/info', apiKey);
    return 'valida';
  } catch (errore) {
    if (errore.stato === 401 || errore.stato === 403) return 'non_valida';
    return 'sconosciuto';
  }
}
