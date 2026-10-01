# shellcheck shell=bash
# ════════════════════════════════════════════════════════════════════
# comune.sh — PARTI IN COMUNE DEGLI SCRIPT DA LANCIARE DAL PC
# ════════════════════════════════════════════════════════════════════
# Caricato da aggiorna.sh e trasferisci-database.sh, non si lancia da
# solo. Server e chiave SSH si cambiano con le variabili d'ambiente:
#
#   SERVER=ubuntu@1.2.3.4 CHIAVE=~/.ssh/altra.key npm run deploy
# ════════════════════════════════════════════════════════════════════

SERVER=${SERVER:-ubuntu@204.216.217.195}
CHIAVE=${CHIAVE:-$HOME/.ssh/pokeportfolio.key}
BRANCH=${BRANCH:-feat/backend-server}

CARTELLA_DEPLOY=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
RADICE_REPO=$(cd "$CARTELLA_DEPLOY/.." && pwd)

passo()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
info()   { printf '    %s\n' "$*"; }
avviso() { printf '\033[1;33m[ATTENZIONE]\033[0m %s\n' "$*" >&2; }
errore() { printf '\033[1;31m[ERRORE]\033[0m %s\n' "$*" >&2; exit 1; }

# Opzioni SSH: chiave dedicata, niente password, timeout brevi.
# StrictHostKeyChecking=accept-new: la prima volta memorizza l'impronta
# del server, poi rifiuta il collegamento se cambia.
# shellcheck disable=SC2034  # usata dagli script che caricano questo file
OPZIONI_SSH=(-i "$CHIAVE" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15
             -o ServerAliveInterval=30 -o StrictHostKeyChecking=accept-new)

controlla_chiave() {
  [ -f "$CHIAVE" ] || errore "Chiave SSH non trovata: $CHIAVE
        Copiala lì (vedi deploy/README.md) oppure indica dove si trova: CHIAVE=/percorso/chiave npm run deploy"
  local permessi
  permessi=$(stat -c '%a' "$CHIAVE")
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
