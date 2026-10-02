# shellcheck shell=bash
# ════════════════════════════════════════════════════════════════════
# comune.sh — PARTI IN COMUNE DEGLI SCRIPT DA LANCIARE DAL PC
# ════════════════════════════════════════════════════════════════════
# Caricato da installa.sh, aggiorna.sh, trasferisci-database.sh e
# cambia-password.sh, non si lancia da solo.
#
# Le impostazioni stanno nel file ~/.config/pokeportfolio/server.env del
# PC (permessi 600), una per riga, NOME=valore, senza spazi né virgolette:
#
#   SERVER=ubuntu@1.2.3.4          utente e IP del server (obbligatoria)
#   DOMINIO=tuonome.duckdns.org    dominio dell'app (lo usa installa.sh)
#   CHIAVE=~/.ssh/altra.key        chiave SSH (predefinita ~/.ssh/pokeportfolio.key)
#   BRANCH=...                     branch da installare (predefinito feat/backend-server)
#   REPO_URL=https://...           repository da clonare (per chi usa un fork)
#
# Dal file si leggono solo queste righe, una alla volta: il file non
# viene eseguito. Una variabile d'ambiente ha la precedenza sul file:
#
#   SERVER=ubuntu@5.6.7.8 npm run deploy
# ════════════════════════════════════════════════════════════════════

FILE_SEGRETI=${FILE_SEGRETI:-$HOME/.config/pokeportfolio/server.env}

# Valore dell'ultima riga NOME=... del file delle impostazioni (vuoto se
# il file o la riga mancano). Le altre righe vengono lette e scartate.
leggi_impostazione() { # <nome>
  local nome=$1 riga valore=
  [ -r "$FILE_SEGRETI" ] || return 0
  while IFS= read -r riga || [ -n "$riga" ]; do
    riga=${riga%$'\r'}
    case "$riga" in "$nome="*) valore=${riga#*=} ;; esac
  done < "$FILE_SEGRETI"
  printf '%s' "$valore"
}

# Precedenza: variabile d'ambiente, poi file, poi valore predefinito.
SERVER=${SERVER:-$(leggi_impostazione SERVER)}
CHIAVE=${CHIAVE:-$(leggi_impostazione CHIAVE)}
CHIAVE=${CHIAVE:-$HOME/.ssh/pokeportfolio.key}
# Nel file la tilde non viene espansa dalla shell: lo faccio io.
# shellcheck disable=SC2088  # la tilde va confrontata come testo
case "$CHIAVE" in "~/"*) CHIAVE=$HOME/${CHIAVE#"~/"} ;; esac
BRANCH=${BRANCH:-$(leggi_impostazione BRANCH)}
BRANCH=${BRANCH:-feat/backend-server}
REPO_URL=${REPO_URL:-$(leggi_impostazione REPO_URL)}
REPO_URL=${REPO_URL:-https://github.com/LukinoDeveloppino/PokePortfolio.git}

CARTELLA_DEPLOY=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
RADICE_REPO=$(cd "$CARTELLA_DEPLOY/.." && pwd)

passo()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
info()   { printf '    %s\n' "$*"; }
avviso() { printf '\033[1;33m[ATTENZIONE]\033[0m %s\n' "$*" >&2; }
errore() { printf '\033[1;31m[ERRORE]\033[0m %s\n' "$*" >&2; exit 1; }

# SERVER è obbligatoria e finisce in comandi ssh: la controllo.
controlla_server() {
  [ -n "$SERVER" ] || errore "Non so a quale server collegarmi. Aggiungi in $FILE_SEGRETI la riga
        SERVER=ubuntu@<IP-del-tuo-server>
        per esempio SERVER=ubuntu@1.2.3.4 (senza spazi né virgolette), poi rilancia il comando."
  [[ "$SERVER" =~ ^([A-Za-z0-9._-]+@)?[A-Za-z0-9.-]+$ ]] \
    || errore "SERVER non valido: '$SERVER'. Deve essere nella forma utente@IP, per esempio
        SERVER=ubuntu@1.2.3.4 in $FILE_SEGRETI."
  # Branch e repository finiscono anche loro in comandi remoti.
  [[ "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] || errore "BRANCH non valido: '$BRANCH'."
  [[ "$REPO_URL" =~ ^(https://|git@)[A-Za-z0-9._/:@~-]+$ ]] || errore "REPO_URL non valido: '$REPO_URL'."
}

# Opzioni SSH: chiave dedicata, niente password, timeout brevi.
# StrictHostKeyChecking=accept-new: la prima volta memorizza l'impronta
# del server, poi rifiuta il collegamento se cambia.
# shellcheck disable=SC2034  # usata dagli script che caricano questo file
OPZIONI_SSH=(-i "$CHIAVE" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15
             -o ServerAliveInterval=30 -o StrictHostKeyChecking=accept-new)

# Permessi di un file in ottale (600, 644...), su Linux e su macOS.
permessi_di() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"; }

controlla_chiave() {
  [ -f "$CHIAVE" ] || errore "Chiave SSH non trovata: $CHIAVE
        Spostala lì (vedi README.md, passo 6) oppure scrivi dove si trova
        aggiungendo in $FILE_SEGRETI la riga CHIAVE=/percorso/della/chiave"
  local permessi
  permessi=$(permessi_di "$CHIAVE")
  case "$permessi" in
    600|400) ;;
    *) errore "La chiave $CHIAVE ha permessi $permessi: SSH la rifiuta. Sistemali con:
        chmod 600 $CHIAVE" ;;
  esac
}

# Stampa un comando in forma copiabile (per --dry-run).
mostra_comando() {
  printf '   '
  printf ' %q' "$@"
  printf '\n'
}

# Avvisa se il PC ha commit non ancora su GitHub: il server scarica il
# codice da GitHub, non dal PC.
controlla_commit_non_pushati() {
  local ramo_attuale da_pushare
  if ! git -C "$RADICE_REPO" rev-parse --git-dir >/dev/null 2>&1; then
    avviso "Non trovo il repository git sul PC: salto il controllo dei commit."
    return 0
  fi
  if ! git -C "$RADICE_REPO" fetch --quiet origin "$BRANCH" 2>/dev/null; then
    avviso "Non riesco a contattare GitHub dal PC: controllo con l'ultimo stato scaricato."
  fi
  ramo_attuale=$(git -C "$RADICE_REPO" rev-parse --abbrev-ref HEAD)
  if [ "$ramo_attuale" != "$BRANCH" ]; then
    avviso "Sul PC sei sul branch '$ramo_attuale', ma il server installa '$BRANCH' da GitHub."
  fi
  if ! git -C "$RADICE_REPO" rev-parse --verify --quiet "origin/$BRANCH" >/dev/null; then
    avviso "Il branch origin/$BRANCH non esiste sul PC: fai prima git push."
    return 1
  fi
  da_pushare=$(git -C "$RADICE_REPO" rev-list --count "origin/$BRANCH..$BRANCH" 2>/dev/null || echo 0)
  if [ "$da_pushare" -gt 0 ]; then
    avviso "Ci sono $da_pushare commit su $BRANCH non ancora pushati su GitHub:"
    git -C "$RADICE_REPO" log --oneline "origin/$BRANCH..$BRANCH" | sed 's/^/      /' >&2
    avviso "Il server non li vedrà finché non fai: git push origin $BRANCH"
    return 1
  fi
  if [ -n "$(git -C "$RADICE_REPO" status --porcelain --untracked-files=no)" ]; then
    avviso "Sul PC ci sono modifiche non committate: non arriveranno sul server."
  fi
  return 0
}

# Chiede conferma (s/N). Senza terminale (o con --si) risponde da sé.
conferma() {
  local risposta
  if [ "${SI_A_TUTTO:-0}" = 1 ]; then return 0; fi
  if [ ! -t 0 ]; then
    errore "$1 Rilancia con --si per procedere comunque."
  fi
  read -r -p "$1 Continuare? [s/N] " risposta
  case "$risposta" in s|S|si|SI|sì|Sì) return 0 ;; *) errore "Annullato." ;; esac
}
