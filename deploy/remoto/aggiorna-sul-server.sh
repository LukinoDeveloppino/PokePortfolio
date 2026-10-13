#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
# aggiorna-sul-server.sh — PARTE DI aggiorna.sh CHE GIRA SUL SERVER
# ════════════════════════════════════════════════════════════════════
# Non va lanciato a mano: aggiorna.sh lo manda al server via SSH
# (bash -s -- <branch>) e lo esegue come utente ubuntu, che usa sudo.
#
#   1. controlla che sul server non ci siano modifiche locali al codice;
#   2. scarica il branch da GitHub; se non c'è niente di nuovo si ferma;
#   3. backup del database (e copia su Oracle Object Storage, se attiva:
#      se la copia non riesce è solo un avviso, l'aggiornamento continua);
#   4. porta il codice all'ultimo commit, npm ci solo se package-lock.json
#      è cambiato, migrazioni, riavvio del servizio;
#   5. health check; se fallisce torna al commit di prima e riavvia.
#
# Tutto il lavoro sta nella funzione principale(), chiamata in fondo con
# l'ingresso da /dev/null: bash legge lo script da SSH, e così nessun
# comando (sudo, git, npm) può "mangiarsi" il resto dello script.
# ════════════════════════════════════════════════════════════════════

set -Eeuo pipefail

BRANCH=${1:?branch mancante}
UTENTE_APP=pokeportfolio
CARTELLA_APP=/opt/pokeportfolio
URL_SALUTE=http://127.0.0.1:3000/api/health
TENTATIVI_SALUTE=20
PAUSA_SALUTE=3

passo()  { printf '\n\033[1;34m[server] ==> %s\033[0m\n' "$*"; }
info()   { printf '    %s\n' "$*"; }
avviso() { printf '\033[1;33m[ATTENZIONE]\033[0m %s\n' "$*" >&2; }
errore() { printf '\033[1;31m[ERRORE]\033[0m %s\n' "$*" >&2; exit 1; }

git_app() { sudo -u "$UTENTE_APP" -H git -C "$CARTELLA_APP" "$@"; }
npm_app() { sudo -u "$UTENTE_APP" -H bash -c "cd '$CARTELLA_APP' && npm $*"; }
descrivi() { git_app log -1 --format='%h  %s  (%cd)' --date=format:'%d/%m/%Y %H:%M' "$1"; }

app_in_salute() {
  local i
  for i in $(seq 1 "$TENTATIVI_SALUTE"); do
    if curl -fsS --max-time 5 "$URL_SALUTE" >/dev/null 2>&1; then return 0; fi
    info "health check $i/$TENTATIVI_SALUTE: non ancora pronta..."
    sleep "$PAUSA_SALUTE"
  done
  return 1
}

# In caso di errore durante l'aggiornamento torno al commit di prima.
ripristina() {
  local motivo=$1
  trap - ERR
  set +e
  printf '\n\033[1;31m[ERRORE]\033[0m %s\n' "$motivo" >&2
  passo "Torno al commit di prima: $(descrivi "$PRIMA")"
  git_app checkout -q "$BRANCH"
  git_app reset -q --hard "$PRIMA"
  if [ "$DIPENDENZE_CAMBIATE" = 1 ]; then npm_app ci --omit=dev --no-audit --no-fund; fi
  sudo systemctl restart pokeportfolio
  if app_in_salute; then
    info "Il server è tornato alla versione di prima e funziona."
  else
    printf '\033[1;31m[ERRORE]\033[0m Anche la versione di prima non risponde!\n' >&2
  fi
  echo
  echo "Ultime righe del log dell'app:"
  sudo journalctl -u pokeportfolio -n 40 --no-pager
  echo
  echo "AGGIORNAMENTO FALLITO. Il server è a: $(descrivi "$(git_app rev-parse HEAD)")"
  echo "Se una migrazione ha già cambiato il database, il backup appena fatto è in"
  echo "/var/backups/pokeportfolio/ (file pokeportfolio-aggiornamento-*.dump)."
  exit 1
}

principale() {
  [ -d "$CARTELLA_APP/.git" ] || errore "Non trovo $CARTELLA_APP: lancia prima deploy/installa-server.sh sul server."

  # ---- 1. Codice sul server senza modifiche locali ----
  passo "Controllo del codice sul server"
  modifiche=$(git_app status --porcelain --untracked-files=no)
  if [ -n "$modifiche" ]; then
    printf '%s\n' "$modifiche" | sed 's/^/      /' >&2
    errore "Sul server ci sono file del codice modificati a mano (elencati sopra).
          Non li butto via: guardali con
            sudo -u $UTENTE_APP git -C $CARTELLA_APP diff
          e, se non servono, annullali con
            sudo -u $UTENTE_APP git -C $CARTELLA_APP checkout -- .
          poi rilancia l'aggiornamento."
  fi
  PRIMA=$(git_app rev-parse HEAD)
  info "Ora il server è a: $(descrivi "$PRIMA")"

  # ---- 2. Novità da GitHub ----
  passo "Scarico $BRANCH da GitHub"
  git_app fetch --quiet --prune origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
  DOPO=$(git_app rev-parse "origin/$BRANCH")
  if [ "$PRIMA" = "$DOPO" ]; then
    info "Nessun commit nuovo su GitHub: il server è già aggiornato."
    exit 0
  fi
  info "Nuovi commit:"
  git_app log --oneline "$PRIMA..$DOPO" | sed 's/^/      /'

  DIPENDENZE_CAMBIATE=0
  if ! git_app diff --quiet "$PRIMA" "$DOPO" -- package-lock.json; then DIPENDENZE_CAMBIATE=1; fi

  # ---- 3. Backup del database ----
  passo "Backup del database prima dell'aggiornamento"
  sudo -u postgres /usr/local/sbin/pokeportfolio-backup aggiornamento
  # Copia su Object Storage (vedi installa-server.sh, sezione 10b): la fa
  # la sua unit, come utente dedicato. Se non riesce non blocco niente:
  # il backup locale appena fatto basta per tornare indietro.
  if [ -f /etc/pokeportfolio/backup-remoto.conf ]; then
    passo "Copia del backup su Oracle Object Storage"
    if sudo systemctl start pokeportfolio-backup-remoto@aggiornamento.service; then
      info "Copiato nel bucket."
    else
      avviso "Copia su Object Storage non riuscita: l'aggiornamento continua col backup locale.
          Dettagli: sudo journalctl -u pokeportfolio-backup-remoto@aggiornamento -n 30"
    fi
  fi

  # ---- 4. Aggiornamento ----
  # Da qui in poi, in caso di errore, torno al commit di prima.
  trap "ripristina \"un comando dell'aggiornamento è fallito (riga \$LINENO).\"" ERR

  passo "Codice → $(descrivi "$DOPO")"
  git_app checkout -q "$BRANCH"
  git_app reset -q --hard "$DOPO"

  if [ "$DIPENDENZE_CAMBIATE" = 1 ]; then
    passo "package-lock.json cambiato: npm ci --omit=dev"
    npm_app ci --omit=dev --no-audit --no-fund
  else
    info "Dipendenze invariate: salto npm ci."
  fi

  passo "Migrazioni del database"
  npm_app run --silent migrate

  passo "Riavvio del servizio"
  sudo systemctl restart pokeportfolio

  passo "Health check su $URL_SALUTE"
  app_in_salute || ripristina "l'app non risponde dopo il riavvio."
  trap - ERR

  echo
  echo "════════════════════════════════════════════════════════════════════"
  echo " Aggiornamento riuscito"
  echo "   era a: $(descrivi "$PRIMA")"
  echo "   ora è: $(descrivi "$DOPO")"
  echo "════════════════════════════════════════════════════════════════════"
}

principale < /dev/null
exit
