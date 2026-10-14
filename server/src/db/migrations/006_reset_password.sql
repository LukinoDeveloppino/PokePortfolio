-- ════════════════════════════════════════════════════════════════════
-- 006_reset_password.sql — LINK PER REIMPOSTARE LA PASSWORD
-- ════════════════════════════════════════════════════════════════════
-- Il proprietario crea un link monouso (npm run password -- <utente>) e
-- lo manda all'utente che ha dimenticato la password. Si salva solo
-- l'hash SHA-256 del codice: chi legge la tabella non può usare i link.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE password_resets (
  code_hash  text PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX password_resets_user_id_idx ON password_resets (user_id);
