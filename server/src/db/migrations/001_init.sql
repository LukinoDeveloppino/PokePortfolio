-- ════════════════════════════════════════════════════════════════════
-- 001_init.sql — SCHEMA INIZIALE
-- ════════════════════════════════════════════════════════════════════
-- Corrispondenza con la versione Google Sheets:
--   foglio UTENTI del master     → users
--   UserProperties (sessione)    → sessions
--   BATCH_STATE (parametri)      → settings
--   BATCH_STATE (catalog_*, ...) → job_runs
--   SET_CACHE / CACHE_CARDS      → sets / cards
--   CONFIG.hidden_sets           → hidden_sets
--   PORTFOLIO / WISHLIST         → collection_items (colonna list)
--   CARD_/WISHLIST_PRICE_HISTORY → item_price_history (da matrice a righe)
--   PRICE_HISTORY                → value_history
-- ════════════════════════════════════════════════════════════════════


-- ---- Utenti e sessioni ----

CREATE TABLE users (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username           text NOT NULL,
  password_hash      text NOT NULL,
  -- 'sha256' = hash importato da Sheets (senza salt): al primo login
  -- riuscito viene sostituito da un hash 'argon2'.
  hash_algo          text NOT NULL CHECK (hash_algo IN ('sha256', 'argon2')),
  -- NULL = usa CARDTRADER_DEFAULT_TOKEN.
  cardtrader_api_key text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Username univoco senza distinzione fra maiuscole e minuscole, come in
-- Sheets. Indice su lower() invece di citext: nessuna estensione da
-- abilitare sul database gestito.
CREATE UNIQUE INDEX users_username_lower_idx ON users (lower(username));

CREATE TABLE sessions (
  token      text PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);


-- ---- Parametri globali e stato dei job ----

CREATE TABLE settings (
  key   text PRIMARY KEY,
  value text
);

CREATE TABLE job_runs (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job           text NOT NULL CHECK (job IN ('catalog_sync', 'prices')),
  -- catalog_sync: 'sync' (solo set nuovi) | 'refresh' (ricontrolla tutti)
  mode          text,
  status        text NOT NULL CHECK (status IN ('running', 'done', 'failed')),
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  changed_count integer NOT NULL DEFAULT 0,
  error         text
);

CREATE INDEX job_runs_job_started_idx ON job_runs (job, started_at DESC);

-- Al massimo un'esecuzione in corso per tipo di job.
CREATE UNIQUE INDEX job_runs_one_running_idx ON job_runs (job) WHERE status = 'running';


-- ---- Catalogo (condiviso fra tutti gli utenti) ----

CREATE TABLE sets (
  -- id dell'espansione su CardTrader (in Sheets: set_id = ct_expansion_id).
  id           integer PRIMARY KEY,
  name         text NOT NULL,
  series       text NOT NULL CHECK (series IN ('INT', 'JP')),
  logo_url     text,
  release_date date,
  total_cards  integer NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cards (
  -- '<set_id>_<blueprint_id>': deterministico, stesso formato di Sheets,
  -- così le voci importate continuano a puntare alle carte giuste.
  id           text PRIMARY KEY,
  blueprint_id integer NOT NULL,
  set_id       integer NOT NULL REFERENCES sets (id) ON DELETE CASCADE,
  name         text NOT NULL,
  number       text,
  rarity       text,
  image_url    text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cards_set_id_idx ON cards (set_id);
CREATE INDEX cards_name_lower_idx ON cards (lower(name));

-- Blacklist personale dei set (tasto ⊘ nel catalogo). Nessuna FK verso
-- sets: un set sparito dal catalogo non deve far fallire nulla.
CREATE TABLE hidden_sets (
  user_id bigint  NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  set_id  integer NOT NULL,
  PRIMARY KEY (user_id, set_id)
);


-- ---- Portfolio e lista dei desideri ----

CREATE TABLE collection_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  list         text   NOT NULL CHECK (list IN ('portfolio', 'wishlist')),
  -- Nessuna FK verso cards: il refresh di un set cancella e riscrive le
  -- sue carte, e una FK farebbe fallire il refresh (o cancellerebbe le
  -- voci degli utenti con ON DELETE CASCADE).
  card_id      text    NOT NULL,
  quantity     integer NOT NULL CHECK (quantity > 0),
  condition    text    NOT NULL,
  language     text    NOT NULL,
  finish       text    NOT NULL,
  blueprint_id integer,
  last_price   numeric(10, 2),
  added_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX collection_items_user_list_idx ON collection_items (user_id, list);


-- ---- Storici dei prezzi ----

-- Un punto per voce per giro del batch notturno (ex matrice a colonne).
CREATE TABLE item_price_history (
  item_id uuid        NOT NULL REFERENCES collection_items (id) ON DELETE CASCADE,
  ts      timestamptz NOT NULL,
  price   numeric(10, 2) NOT NULL,
  PRIMARY KEY (item_id, ts)
);

-- Valore totale del portfolio di un utente nel tempo.
CREATE TABLE value_history (
  user_id     bigint      NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  ts          timestamptz NOT NULL,
  total_value numeric(12, 2) NOT NULL,
  PRIMARY KEY (user_id, ts)
);
