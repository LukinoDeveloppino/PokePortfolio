// ════════════════════════════════════════════════════════════════════
// errori.js — ERRORI APPLICATIVI
// ════════════════════════════════════════════════════════════════════
// Il frontend si aspetta sempre { success: false, error: '...' } (vedi
// _wrapApiCall nella versione GAS). Gli errori "previsti" usano queste
// classi: il loro messaggio arriva così com'è all'utente. Tutti gli
// altri diventano un messaggio generico e finiscono nei log.
// ════════════════════════════════════════════════════════════════════

export class ErroreApi extends Error {
  constructor(messaggio) {
    super(messaggio);
    this.name = 'ErroreApi';
  }
}

export class NonAutorizzato extends ErroreApi {
  constructor() {
    super('UNAUTHORIZED');
    this.name = 'NonAutorizzato';
  }
}
