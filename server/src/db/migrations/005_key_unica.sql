-- ════════════════════════════════════════════════════════════════════
-- 005_key_unica.sql — UNA SOLA KEY CARDTRADER, QUELLA DEL PROPRIETARIO
-- ════════════════════════════════════════════════════════════════════
-- I prezzi di tutti gli utenti si chiedono a CardTrader con la key del
-- proprietario (CARDTRADER_DEFAULT_TOKEN), come il catalogo. Le key
-- personali non servono più: la key dà accesso completo all'account
-- CardTrader, quindi non si tengono nel database.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE users DROP COLUMN cardtrader_api_key;
