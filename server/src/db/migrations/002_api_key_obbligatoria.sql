-- ════════════════════════════════════════════════════════════════════
-- 002_api_key_obbligatoria.sql — KEY CARDTRADER PER OGNI UTENTE
-- ════════════════════════════════════════════════════════════════════
-- Da questa versione i prezzi di un utente si chiedono a CardTrader solo
-- con la sua key: la key di default del proprietario resta per il
-- catalogo. Gli utenti importati da Sheets con la key vuota (in GAS
-- avevano una copia della key di default) ricevono il default_token
-- importato, se c'è.
--
-- Se default_token manca, la key vera può stare solo nella variabile
-- CARDTRADER_DEFAULT_TOKEN: ci pensa l'avvio del server (vedi
-- assegnaKeyDiDefaultAgliUtentiSenzaKey in services/settings.js).
--
-- La colonna resta nullable: questa migrazione gira prima di quel passo
-- all'avvio, e un NOT NULL qui fallirebbe (bloccando il server) proprio
-- nel caso in cui la key è solo nell'ambiente. Il vincolo vero è nella
-- registrazione, che rifiuta gli account senza key.
-- ════════════════════════════════════════════════════════════════════

UPDATE users u
   SET cardtrader_api_key = s.value
  FROM settings s
 WHERE s.key = 'default_token'
   AND coalesce(s.value, '') <> ''
   AND u.cardtrader_api_key IS NULL;

COMMENT ON COLUMN users.cardtrader_api_key IS
  'API key CardTrader personale, usata per i prezzi. NULL = nessuna chiamata a CardTrader per questo utente.';
