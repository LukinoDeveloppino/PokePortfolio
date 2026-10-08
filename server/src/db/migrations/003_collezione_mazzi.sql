-- ════════════════════════════════════════════════════════════════════
-- 003_collezione_mazzi.sql — COLLEZIONE DI GIOCO E MAZZI
-- ════════════════════════════════════════════════════════════════════
-- Sezioni separate dal portfolio: niente prezzi, solo quante copie di
-- una carta ha l'utente per giocare e i mazzi che vuole costruire.
--
-- Le carte vengono dal repository GitHub di PokemonTCG (non da
-- CardTrader), che dice per ogni carta il tipo (Pokémon / Allenatore /
-- Energia), il simbolo di regolamento (G, H, I…) e usa le stesse sigle
-- dei set delle liste di Limitless e Pokémon TCG Live.
--
-- "Stessa carta" ai fini del gioco = stessa game_key (vedi services/tcg.js):
--   • Allenatori ed Energie speciali: stesso nome;
--   • Pokémon: stesso nome e stessi attacchi e abilità;
--   • Energie base: stesso nome (non si contano mai nella collezione).
-- ════════════════════════════════════════════════════════════════════


-- ---- Catalogo delle carte da gioco (condiviso) ----

CREATE TABLE tcg_sets (
  -- id del set su GitHub (es. 'sv6').
  id           text PRIMARY KEY,
  name         text NOT NULL,
  -- Sigla usata da Limitless e Pokémon TCG Live (es. 'TWM'). Alcuni set
  -- la condividono con il loro "Trainer Gallery".
  code         text,
  release_date date,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tcg_sets_code_idx ON tcg_sets (upper(code));

CREATE TABLE tcg_cards (
  -- id della carta su GitHub (es. 'sv6-130').
  id              text PRIMARY KEY,
  set_id          text NOT NULL REFERENCES tcg_sets (id) ON DELETE CASCADE,
  number          text NOT NULL,
  -- Nome come lo scrive il gioco, senza il suffisso degli Allenatori
  -- ("Boss's Orders (Ghetsis)" → "Boss's Orders").
  name            text NOT NULL,
  supertype       text NOT NULL CHECK (supertype IN ('Pokémon', 'Trainer', 'Energy')),
  subtypes        text[] NOT NULL DEFAULT '{}',
  -- NULL per le Energie base, che restano sempre legali.
  regulation_mark text,
  game_key        text NOT NULL,
  rarity          text,
  image_small     text,
  image_large     text
);

CREATE INDEX tcg_cards_game_key_idx ON tcg_cards (game_key);
CREATE INDEX tcg_cards_set_number_idx ON tcg_cards (set_id, number);
CREATE INDEX tcg_cards_name_lower_idx ON tcg_cards (lower(name));


-- ---- Collezione di gioco dell'utente ----

-- Una riga per carta "di gioco": quante copie ne ha l'utente, qualunque
-- sia la stampa. card_id è la stampa scelta quando l'ha aggiunta, usata
-- solo per mostrarla (immagine, set). Nessuna FK verso tcg_cards: la sync
-- riscrive le carte dei set.
CREATE TABLE tcg_collection (
  user_id   bigint  NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  game_key  text    NOT NULL,
  card_id   text    NOT NULL,
  name      text    NOT NULL,
  quantity  integer NOT NULL CHECK (quantity BETWEEN 1 AND 999),
  added_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, game_key)
);


-- ---- Mazzi ----

CREATE TABLE decks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name        text   NOT NULL,
  -- NULL = solo un'idea; valorizzato = costruito fisicamente da quel
  -- momento. Le carte dei mazzi costruiti sono "impegnate": l'ordine di
  -- costruzione decide chi le prende per primo se non bastano.
  built_at    timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX decks_user_id_idx ON decks (user_id);

CREATE TABLE deck_cards (
  deck_id   uuid    NOT NULL REFERENCES decks (id) ON DELETE CASCADE,
  -- Stampa indicata nella lista (es. 'sv6-130'), per la lista esportata.
  card_id   text    NOT NULL,
  game_key  text    NOT NULL,
  name      text    NOT NULL,
  quantity  integer NOT NULL CHECK (quantity BETWEEN 1 AND 60),
  position  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (deck_id, card_id)
);


-- ---- Nuovo job: download del catalogo da gioco ----

ALTER TABLE job_runs DROP CONSTRAINT job_runs_job_check;
ALTER TABLE job_runs ADD CONSTRAINT job_runs_job_check
  CHECK (job IN ('catalog_sync', 'prices', 'tcg_sync'));
