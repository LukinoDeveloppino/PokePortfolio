-- ════════════════════════════════════════════════════════════════════
-- 004_riconoscimento.sql — RICONOSCIMENTO DELLE CARTE DA FOTO
-- ════════════════════════════════════════════════════════════════════
-- Per ogni carta da gioco in versione "base" (Common, Uncommon, Rare,
-- Double Rare, ACE SPEC) si salva un'impronta dell'immagine ufficiale:
-- una miniatura 16×22 a colori, 1056 byte. Una foto si riconosce
-- cercando le impronte più simili alla sua (k-nearest neighbors, vedi
-- services/riconoscimento.js).
--
-- Nessuna FK verso tcg_cards: la sync cancella e riscrive le carte di
-- ogni set, e le impronte devono sopravvivere. image_url dice da quale
-- immagine è stata calcolata: se cambia, l'impronta si ricalcola.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE tcg_card_vectors (
  card_id    text PRIMARY KEY,
  image_url  text  NOT NULL,
  vector     bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
