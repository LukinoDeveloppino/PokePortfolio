#!/usr/bin/env python3
# ════════════════════════════════════════════════════════════════════
# knn_carte.py — PROVA DI RICONOSCIMENTO DELLE CARTE CON KNN
# ════════════════════════════════════════════════════════════════════
# Esperimento: riconoscere una carta da una foto cercando, fra le
# immagini ufficiali delle carte dello Standard, quella più "vicina"
# (k-nearest neighbors).
#
# Le carte arrivano dallo stesso repository GitHub di PokemonTCG usato da
# server/src/services/tcg.js: solo Pokémon e Allenatori (Strumenti
# compresi), solo con simbolo di regolamento ammesso in Standard.
#
# Comandi:
#   scarica    scarica elenco e immagini delle carte in dataset/
#   addestra   calcola le caratteristiche delle immagini e salva il modello
#   valuta     prova il modello su "foto" simulate (immagini deformate)
#   riconosci  riconosce una o più foto vere
#   mappa      disegna le carte su un piano (pagina HTML interattiva)
#
# Esempio:
#   python knn_carte.py scarica
#   python knn_carte.py addestra --estrattore cnn
#   python knn_carte.py valuta --estrattore cnn
#   python knn_carte.py riconosci foto.jpg --estrattore cnn
#   python knn_carte.py mappa --estrattore cnn --foto foto.jpg
# ════════════════════════════════════════════════════════════════════

import argparse
import hashlib
import json
import random
import sys
import time
import unicodedata
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter

URL_BASE_GITHUB = 'https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master'
ANNI_DI_CATALOGO = 5
LETTERE_STANDARD_PREDEFINITE = 'H,I,J'

CARTELLA = Path(__file__).resolve().parent / 'dataset'
CARTELLA_IMMAGINI = CARTELLA / 'immagini'
FILE_CARTE = CARTELLA / 'carte.json'

# Proporzioni di una carta: 63 × 88 mm.
LARGHEZZA, ALTEZZA = 224, 312


# ════════════════════════════════════════════════════════════════════
# NOMI E "STESSA CARTA" (come in tcg.js)
# ════════════════════════════════════════════════════════════════════
# La collezione conta le carte per identità di gioco, non per stampa:
# un errore fra due stampe della stessa carta non è un errore vero.

def normalizza_nome(nome):
    testo = unicodedata.normalize('NFD', str(nome or ''))
    testo = ''.join(c for c in testo if not unicodedata.combining(c))
    for apostrofo in '‘’ʼ`':
        testo = testo.replace(apostrofo, "'")
    return ' '.join(testo.lower().split())


def nome_di_gioco(carta):
    nome = ' '.join(str(carta.get('name') or '').split())
    if carta.get('supertype') == 'Trainer' and nome.endswith(')') and ' (' in nome:
        nome = nome[:nome.rindex(' (')]
    return nome


def chiave_di_gioco(carta):
    nome = normalizza_nome(nome_di_gioco(carta))
    if carta.get('supertype') == 'Pokémon':
        effetti = [
            [[normalizza_nome(a.get('name')), normalizza_nome(a.get('text'))] for a in carta.get('abilities') or []],
            [[normalizza_nome(a.get('name')), ','.join(a.get('cost') or []),
              str(a.get('damage') or ''), normalizza_nome(a.get('text'))] for a in carta.get('attacks') or []],
        ]
        # Stesso JSON compatto di JSON.stringify, per avere la stessa chiave.
        testo = json.dumps(effetti, ensure_ascii=False, separators=(',', ':'))
        return f'P|{nome}|{hashlib.sha1(testo.encode()).hexdigest()[:12]}'
    return f'T|{nome}'


# ════════════════════════════════════════════════════════════════════
# SCARICA
# ════════════════════════════════════════════════════════════════════

def scarica_url(url, tentativi=3):
    for tentativo in range(tentativi):
        try:
            # Il server delle immagini rifiuta lo user-agent predefinito di Python.
            richiesta = urllib.request.Request(url, headers={'User-Agent': 'PokePortfolio-knn/1.0'})
            with urllib.request.urlopen(richiesta, timeout=30) as risposta:
                return risposta.read()
        except Exception:
            if tentativo == tentativi - 1:
                raise
            time.sleep(1 + tentativo)


def comando_scarica(arg):
    lettere = [l.strip().upper() for l in arg.lettere.split(',') if l.strip()]
    anno_minimo = date.today().year - ANNI_DI_CATALOGO

    insiemi = json.loads(scarica_url(f'{URL_BASE_GITHUB}/sets/en.json'))
    insiemi = [s for s in insiemi if int(s['releaseDate'][:4]) >= anno_minimo]
    print(f'Set degli ultimi {ANNI_DI_CATALOGO} anni: {len(insiemi)}')

    carte = []
    for insieme in insiemi:
        try:
            dati = json.loads(scarica_url(f"{URL_BASE_GITHUB}/cards/en/{insieme['id']}.json"))
        except Exception as errore:
            print(f"  {insieme['id']}: non scaricato ({errore})")
            continue
        scelte = [
            c for c in dati
            if c.get('supertype') in ('Pokémon', 'Trainer')
            and c.get('regulationMark') in lettere
            and (c.get('images') or {}).get('small')
        ]
        for c in scelte:
            carte.append({
                'id': c['id'],
                'nome': nome_di_gioco(c),
                'set': insieme['id'],
                'sigla': insieme.get('ptcgoCode') or '',
                'numero': str(c.get('number') or ''),
                'tipo': c['supertype'],
                'sottotipi': c.get('subtypes') or [],
                'regolamento': c['regulationMark'],
                'rarita': c.get('rarity') or '',
                'chiave': chiave_di_gioco(c),
                'immagine': c['images']['small'],
            })
        if scelte:
            print(f"  {insieme['id']:<10} {insieme['name']:<35} {len(scelte):>4} carte")

    CARTELLA_IMMAGINI.mkdir(parents=True, exist_ok=True)
    FILE_CARTE.write_text(json.dumps(carte, ensure_ascii=False, indent=1))
    print(f'Carte in Standard ({",".join(lettere)}): {len(carte)} '
          f'({len({c["chiave"] for c in carte})} carte di gioco diverse)')

    mancanti = [c for c in carte if not percorso_immagine(c).exists()]
    print(f'Immagini da scaricare: {len(mancanti)}')

    def scarica_immagine(carta):
        try:
            percorso_immagine(carta).write_bytes(scarica_url(carta['immagine']))
            return None
        except Exception as errore:
            return f"{carta['id']}: {errore}"

    with ThreadPoolExecutor(max_workers=8) as gruppo:
        for i, errore in enumerate(gruppo.map(scarica_immagine, mancanti), 1):
            if errore:
                print('  non scaricata', errore)
            if i % 200 == 0:
                print(f'  {i}/{len(mancanti)}')
    print('Fatto.')


def percorso_immagine(carta):
    return CARTELLA_IMMAGINI / f"{carta['id']}.png"


def leggi_carte():
    if not FILE_CARTE.exists():
        sys.exit('Manca il dataset: lancia prima "python knn_carte.py scarica".')
    carte = json.loads(FILE_CARTE.read_text())
    return [c for c in carte if percorso_immagine(c).exists()]


# ════════════════════════════════════════════════════════════════════
# IMMAGINI E "FOTO" SIMULATE
# ════════════════════════════════════════════════════════════════════

def apri_carta(percorso):
    # Le immagini ufficiali hanno gli angoli trasparenti: si appoggiano sul
    # bianco, che somiglia al bordo di una carta fotografata.
    immagine = Image.open(percorso).convert('RGBA')
    sfondo = Image.new('RGBA', immagine.size, (255, 255, 255, 255))
    return Image.alpha_composite(sfondo, immagine).convert('RGB').resize((LARGHEZZA, ALTEZZA))


def simula_foto(immagine, rng, forza=1.0):
    """Deforma un'immagine ufficiale come se fosse una foto fatta a mano:
    sfondo, inclinazione, prospettiva, ritaglio impreciso, luce, sfocatura."""
    l, a = immagine.size
    margine = int(0.12 * l)
    colore = tuple(int(x) for x in rng.integers(0, 256, 3))
    tela = Image.new('RGB', (l + 2 * margine, a + 2 * margine), colore)
    tela.paste(immagine, (margine, margine))

    tela = tela.rotate(rng.uniform(-8, 8) * forza, resample=Image.BICUBIC, fillcolor=colore)

    # Prospettiva: ogni angolo si sposta un po' a caso.
    L, A = tela.size
    d = 0.06 * forza
    angoli = [(0, 0), (L, 0), (L, A), (0, A)]
    spostati = [(x + rng.uniform(-d, d) * L, y + rng.uniform(-d, d) * A) for x, y in angoli]
    tela = tela.transform(tela.size, Image.PERSPECTIVE, coefficienti_prospettiva(spostati, angoli),
                          resample=Image.BICUBIC, fillcolor=colore)

    # Ritaglio intorno alla carta, mai preciso.
    jitter = lambda: int(rng.uniform(-0.06, 0.06) * forza * l)
    riquadro = (margine + jitter(), margine + jitter(), margine + l + jitter(), margine + a + jitter())
    foto = tela.crop(riquadro).resize((l, a))

    foto = ImageEnhance.Brightness(foto).enhance(1 + rng.uniform(-0.3, 0.3) * forza)
    foto = ImageEnhance.Contrast(foto).enhance(1 + rng.uniform(-0.3, 0.3) * forza)
    foto = ImageEnhance.Color(foto).enhance(1 + rng.uniform(-0.3, 0.3) * forza)
    foto = foto.filter(ImageFilter.GaussianBlur(rng.uniform(0, 1.5) * forza))

    # Riflesso: una macchia chiara in un punto a caso.
    if rng.random() < 0.5 * forza:
        riflesso = Image.new('L', foto.size, 0)
        cx, cy = rng.uniform(0, l), rng.uniform(0, a)
        raggio = rng.uniform(0.1, 0.3) * l
        yy, xx = np.mgrid[0:a, 0:l]
        maschera = np.clip(1 - np.hypot(xx - cx, yy - cy) / raggio, 0, 1) * 160
        riflesso = Image.fromarray(maschera.astype(np.uint8))
        foto = Image.composite(Image.new('RGB', foto.size, (255, 255, 255)), foto, riflesso)

    # Rumore del sensore.
    pixel = np.asarray(foto, dtype=np.float32) + rng.normal(0, 6 * forza, (a, l, 3))
    return Image.fromarray(np.clip(pixel, 0, 255).astype(np.uint8))


def coefficienti_prospettiva(origine, destinazione):
    # PIL vuole i coefficienti che portano i punti di destinazione in quelli di origine.
    righe = []
    for (x, y), (u, v) in zip(destinazione, origine):
        righe.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        righe.append([0, 0, 0, x, y, 1, -v * x, -v * y])
    matrice = np.array(righe, dtype=np.float64)
    termini = np.array(origine, dtype=np.float64).reshape(8)
    return np.linalg.solve(matrice, termini).tolist()


# ════════════════════════════════════════════════════════════════════
# RITAGLIO E RADDRIZZAMENTO (OpenCV)
# ════════════════════════════════════════════════════════════════════
# In una foto vera la carta è piccola, storta e su uno sfondo qualsiasi.
# Prima del confronto la si cerca (il quadrilatero più grande con le
# proporzioni giuste) e la si "stira" su un rettangolo 224×312.
# Resta un dubbio: dritta o capovolta. Lo scioglie il KNN provando entrambe.

def ordina_angoli(punti):
    """Alto-sinistra, alto-destra, basso-destra, basso-sinistra; lato corto in alto."""
    punti = np.asarray(punti, dtype=np.float32).reshape(4, 2)
    centro = punti.mean(axis=0)
    angoli = np.arctan2(punti[:, 1] - centro[1], punti[:, 0] - centro[0])
    punti = punti[np.argsort(angoli)]          # senso orario partendo dall'alto a sinistra circa
    punti = np.roll(punti, -int(np.argmin(punti.sum(axis=1))), axis=0)
    lato = lambda a, b: np.linalg.norm(punti[a] - punti[b])
    # Se il lato "in alto" è il più lungo, la carta è sdraiata: si ruota di un posto.
    if lato(0, 1) + lato(2, 3) > lato(1, 2) + lato(3, 0):
        punti = np.roll(punti, -1, axis=0)
    return punti


def trova_carta(immagine):
    """Restituisce i 4 angoli della carta nella foto (coordinate originali) o None."""
    import cv2
    rgb = np.asarray(immagine.convert('RGB'))
    scala = 800 / max(rgb.shape[:2])
    piccola = cv2.resize(rgb, None, fx=scala, fy=scala, interpolation=cv2.INTER_AREA) if scala < 1 else rgb
    scala = min(scala, 1)
    area_foto = piccola.shape[0] * piccola.shape[1]

    grigio = cv2.GaussianBlur(cv2.cvtColor(piccola, cv2.COLOR_RGB2GRAY), (5, 5), 0)
    # Bordi da due fonti: luminosità (Canny) e colore (il bordo giallo
    # o argento della carta contro lo sfondo), poi chiusi per unire i tratti.
    bordi = cv2.Canny(grigio, 30, 100)
    for canale in cv2.split(cv2.cvtColor(piccola, cv2.COLOR_RGB2HSV))[:2]:
        bordi |= cv2.Canny(cv2.GaussianBlur(canale, (5, 5), 0), 40, 120)
    bordi = cv2.morphologyEx(bordi, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8), iterations=2)

    contorni, _ = cv2.findContours(bordi, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    migliore = None
    for contorno in sorted(contorni, key=cv2.contourArea, reverse=True)[:5]:
        involucro = cv2.convexHull(contorno)
        area = cv2.contourArea(involucro)
        if area < 0.08 * area_foto:
            break
        # Angoli arrotondati: si semplifica il contorno finché restano 4 punti;
        # se non ci si riesce, si usa il rettangolo ruotato che lo contiene.
        perimetro = cv2.arcLength(involucro, True)
        quattro = None
        for tolleranza in (0.02, 0.03, 0.04, 0.06):
            approssimato = cv2.approxPolyDP(involucro, tolleranza * perimetro, True)
            if len(approssimato) == 4:
                quattro = approssimato
                break
        if quattro is None:
            quattro = cv2.boxPoints(cv2.minAreaRect(involucro))
        angoli = ordina_angoli(quattro)
        larghezza = (np.linalg.norm(angoli[0] - angoli[1]) + np.linalg.norm(angoli[3] - angoli[2])) / 2
        altezza = (np.linalg.norm(angoli[1] - angoli[2]) + np.linalg.norm(angoli[0] - angoli[3])) / 2
        # Una carta è 63×88 (0,72): si tollera la prospettiva.
        if 0.5 < larghezza / max(altezza, 1) < 0.95:
            migliore = angoli
            break
    return None if migliore is None else migliore / scala


def raddrizza(immagine, angoli):
    import cv2
    destinazione = np.array([[0, 0], [LARGHEZZA - 1, 0], [LARGHEZZA - 1, ALTEZZA - 1], [0, ALTEZZA - 1]],
                            dtype=np.float32)
    matrice = cv2.getPerspectiveTransform(np.asarray(angoli, dtype=np.float32), destinazione)
    return Image.fromarray(cv2.warpPerspective(np.asarray(immagine.convert('RGB')), matrice,
                                               (LARGHEZZA, ALTEZZA), flags=cv2.INTER_AREA))


def ritaglia_carta(immagine):
    """Foto qualsiasi → carta dritta 224×312. Se la carta non si trova,
    si usa l'immagine intera (si suppone già ritagliata)."""
    angoli = trova_carta(immagine)
    if angoli is None:
        return immagine.convert('RGB').resize((LARGHEZZA, ALTEZZA)), False
    return raddrizza(immagine, angoli), True


def simula_scena(immagine_rgba, rng):
    """Una foto "da tavolo": la carta piccola, ruotata e in prospettiva su
    uno sfondo con texture, luce non uniforme, sfocatura e rumore."""
    import cv2
    L, A = 900, 1200
    # Sfondo: colore di base + venature (legno, tovaglia...) + gradiente di luce.
    base = rng.integers(20, 236, 3).astype(np.float32)
    venature = cv2.GaussianBlur(rng.normal(0, 1, (A // 8, L // 8)).astype(np.float32), (0, 0), rng.uniform(1, 4))
    venature = cv2.resize(venature, (L, A))[..., None] * rng.uniform(5, 25)
    sfondo = np.clip(base + venature, 0, 255)

    carta = np.asarray(immagine_rgba.convert('RGBA'), dtype=np.float32)
    h, w = carta.shape[:2]
    altezza_carta = rng.uniform(0.45, 0.85) * A
    s = altezza_carta / h
    cx, cy = L / 2 + rng.uniform(-0.12, 0.12) * L, A / 2 + rng.uniform(-0.1, 0.1) * A
    angolo = np.radians(rng.uniform(-25, 25) + (180 if rng.random() < 0.15 else 0))
    origine = np.array([[0, 0], [w, 0], [w, h], [0, h]], dtype=np.float32) - [w / 2, h / 2]
    rotazione = np.array([[np.cos(angolo), -np.sin(angolo)], [np.sin(angolo), np.cos(angolo)]])
    punti = origine * s @ rotazione.T + [cx, cy]
    punti += rng.uniform(-0.06, 0.06, (4, 2)) * altezza_carta     # prospettiva
    matrice = cv2.getPerspectiveTransform(np.array([[0, 0], [w, 0], [w, h], [0, h]], dtype=np.float32),
                                          punti.astype(np.float32))
    deformata = cv2.warpPerspective(carta, matrice, (L, A), flags=cv2.INTER_LINEAR)
    alfa = deformata[..., 3:] / 255
    scena = deformata[..., :3] * alfa + sfondo * (1 - alfa)

    # Luce: gradiente e riflesso.
    yy, xx = np.mgrid[0:A, 0:L].astype(np.float32)
    direzione = rng.uniform(-1, 1, 2)
    scena *= (1 + 0.25 * (direzione[0] * (xx / L - 0.5) + direzione[1] * (yy / A - 0.5)))[..., None]
    if rng.random() < 0.5:
        gx, gy, r = rng.uniform(0.2, 0.8) * L, rng.uniform(0.2, 0.8) * A, rng.uniform(0.05, 0.15) * L
        scena += (np.clip(1 - np.hypot(xx - gx, yy - gy) / r, 0, 1) * 140)[..., None]
    scena = cv2.GaussianBlur(np.clip(scena, 0, 255), (0, 0), rng.uniform(0.5, 2.0))
    scena += rng.normal(0, 5, scena.shape)
    return Image.fromarray(np.clip(scena, 0, 255).astype(np.uint8))


# ════════════════════════════════════════════════════════════════════
# ESTRATTORI DI CARATTERISTICHE
# ════════════════════════════════════════════════════════════════════
# Il KNN confronta vettori: ogni estrattore trasforma un'immagine in un
# vettore normalizzato, così la distanza coseno funziona per tutti.
#   pixel  colori di una miniatura 16×22 (il più semplice possibile)
#   grigio miniatura 32×44 in scala di grigi, contrasto livellato
#   hog    forme (istogramma dei gradienti) + istogramma dei colori
#   cnn    rete neurale pre-addestrata su ImageNet (ResNet-50), penultimo strato

class EstrattorePixel:
    def __call__(self, immagini):
        vettori = [np.asarray(i.resize((16, 22), Image.BILINEAR), dtype=np.float32).ravel() for i in immagini]
        return normalizza(np.stack(vettori))


class EstrattoreGrigio:
    # Miniatura in scala di grigi, con luminosità e contrasto livellati:
    # la variante "ritaglia, riduci, togli il colore e confronta".
    def __call__(self, immagini):
        vettori = []
        for immagine in immagini:
            v = np.asarray(immagine.convert('L').resize((32, 44), Image.BILINEAR), dtype=np.float32).ravel()
            vettori.append((v - v.mean()) / (v.std() + 1e-6))
        return normalizza(np.stack(vettori))


class EstrattoreHog:
    def __init__(self):
        from skimage.feature import hog
        self.hog = hog

    def __call__(self, immagini):
        vettori = []
        for immagine in immagini:
            grigio = np.asarray(immagine.convert('L').resize((112, 156)), dtype=np.float32) / 255
            forme = self.hog(grigio, orientations=9, pixels_per_cell=(12, 12), cells_per_block=(2, 2))
            hsv = np.asarray(immagine.convert('HSV').resize((56, 78)))
            colori, _ = np.histogramdd(hsv.reshape(-1, 3).astype(np.float32), bins=(12, 4, 4),
                                       range=((0, 256), (0, 256), (0, 256)))
            colori = colori.ravel() / colori.sum()
            vettori.append(np.concatenate([normalizza(forme[None])[0], normalizza(np.sqrt(colori)[None])[0]]))
        return normalizza(np.stack(vettori))


class EstrattoreCnn:
    def __init__(self):
        import torch
        import torchvision
        pesi = torchvision.models.ResNet50_Weights.IMAGENET1K_V2
        self.torch = torch
        self.rete = torchvision.models.resnet50(weights=pesi)
        self.rete.fc = torch.nn.Identity()
        self.rete.eval()
        self.media = torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1)
        self.scarto = torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1)

    def __call__(self, immagini):
        torch = self.torch
        lotto = np.stack([np.asarray(i.resize((LARGHEZZA, ALTEZZA)), dtype=np.float32) / 255 for i in immagini])
        tensore = (torch.from_numpy(lotto).permute(0, 3, 1, 2) - self.media) / self.scarto
        with torch.inference_mode():
            return normalizza(self.rete(tensore).numpy())


ESTRATTORI = {'pixel': EstrattorePixel, 'grigio': EstrattoreGrigio, 'hog': EstrattoreHog, 'cnn': EstrattoreCnn}


def normalizza(vettori):
    return vettori / np.maximum(np.linalg.norm(vettori, axis=1, keepdims=True), 1e-9)


def estrai_a_lotti(estrattore, immagini, dimensione=32, etichetta=''):
    risultati = []
    for inizio in range(0, len(immagini), dimensione):
        risultati.append(estrattore(immagini[inizio:inizio + dimensione]))
        if etichetta:
            print(f'\r  {etichetta}: {min(inizio + dimensione, len(immagini))}/{len(immagini)}', end='', flush=True)
    if etichetta:
        print()
    return np.concatenate(risultati).astype(np.float32)


# ════════════════════════════════════════════════════════════════════
# ADDESTRA
# ════════════════════════════════════════════════════════════════════
# Il KNN non "impara" davvero: memorizza i vettori di riferimento. Per
# ogni carta si salva l'immagine ufficiale più, se richiesto, qualche
# copia deformata, così i vicini di una foto vera sono più facili da trovare.

def file_modello(estrattore):
    return CARTELLA / f'modello_{estrattore}.npz'


# Versioni "base": le stampe da gioco con la cornice normale. Restano
# fuori full art, illustration rare, hyper rare e promo: chi colleziona
# per giocare ha queste, e meno carte simili vuol dire meno confusione.
RARITA_BASE = {'Common', 'Uncommon', 'Rare', 'Double Rare', 'ACE SPEC Rare'}


def comando_addestra(arg):
    carte = leggi_carte()
    if arg.rarita == 'base':
        if any('rarita' not in c for c in carte):
            sys.exit('Il dataset non ha le rarità: rilancia "python knn_carte.py scarica".')
        carte = [c for c in carte if c['rarita'] in RARITA_BASE]
    estrattore = ESTRATTORI[arg.estrattore]()
    rng = np.random.default_rng(arg.seme)
    print(f'Carte: {len(carte)} (rarità: {arg.rarita}), copie deformate per carta: {arg.aumenti}, '
          f'estrattore: {arg.estrattore}')

    vettori, indici = [], []
    inizio = time.time()
    for blocco in range(0, len(carte), 64):
        immagini, posizioni = [], []
        for i, carta in enumerate(carte[blocco:blocco + 64], blocco):
            originale = apri_carta(percorso_immagine(carta))
            immagini.append(originale)
            posizioni.append(i)
            for _ in range(arg.aumenti):
                immagini.append(simula_foto(originale, rng, forza=0.6))
                posizioni.append(i)
        vettori.append(estrai_a_lotti(estrattore, immagini))
        indici.extend(posizioni)
        print(f'\r  {min(blocco + 64, len(carte))}/{len(carte)} carte', end='', flush=True)
    print(f'\n  {time.time() - inizio:.0f} s')

    np.savez_compressed(file_modello(arg.estrattore), vettori=np.concatenate(vettori),
                        indici=np.array(indici), id=np.array([c['id'] for c in carte]))
    print(f'Modello salvato in {file_modello(arg.estrattore)}')


def carica_modello(estrattore):
    from sklearn.neighbors import NearestNeighbors
    percorso = file_modello(estrattore)
    if not percorso.exists():
        sys.exit(f'Manca il modello: lancia prima "python knn_carte.py addestra --estrattore {estrattore}".')
    dati = np.load(percorso)
    carte_per_id = {c['id']: c for c in leggi_carte()}
    carte = [carte_per_id[i] for i in dati['id']]
    # Distanza coseno su vettori normalizzati; con poche migliaia di carte
    # la ricerca esatta ("brute") è già istantanea.
    knn = NearestNeighbors(metric='cosine', algorithm='brute').fit(dati['vettori'])
    return knn, dati['indici'], carte


def vota(knn, indici, vettori, k, quante=5):
    """Per ogni foto: le carte più votate fra i k vicini, pesate per vicinanza.
    Restituisce liste di (indice carta, punteggio)."""
    distanze, vicini = knn.kneighbors(vettori, n_neighbors=k)
    risultati = []
    for riga_d, riga_v in zip(distanze, vicini):
        punteggi = {}
        for d, v in zip(riga_d, riga_v):
            carta = int(indici[v])
            punteggi[carta] = punteggi.get(carta, 0) + 1 / (d + 1e-6)
        ordinate = sorted(punteggi.items(), key=lambda x: -x[1])[:quante]
        totale = sum(punteggi.values())
        risultati.append([(c, p / totale) for c, p in ordinate])
    return risultati


def vota_due_versi(knn, indici, estrattore, immagini, k):
    """Il ritaglio non sa se la carta è dritta o capovolta: si provano
    entrambe e si tiene quella col vicino più vicino."""
    dritte = estrai_a_lotti(estrattore, immagini)
    capovolte = estrai_a_lotti(estrattore, [i.rotate(180) for i in immagini])
    d_dritte = knn.kneighbors(dritte, n_neighbors=1)[0][:, 0]
    d_capovolte = knn.kneighbors(capovolte, n_neighbors=1)[0][:, 0]
    scelte = np.where((d_capovolte < d_dritte)[:, None], capovolte, dritte)
    return vota(knn, indici, scelte, k)


# ════════════════════════════════════════════════════════════════════
# VALUTA
# ════════════════════════════════════════════════════════════════════
# Non avendo foto vere etichettate, si simulano: per un campione di
# carte si crea una "foto" deformata (con un seme diverso da quello
# dell'addestramento) e si controlla se il KNN ritrova la carta.

def comando_valuta(arg):
    knn, indici, carte = carica_modello(arg.estrattore)
    estrattore = ESTRATTORI[arg.estrattore]()
    rng = np.random.default_rng(arg.seme + 1000)
    campione = random.Random(arg.seme).sample(range(len(carte)), min(arg.campione, len(carte)))

    trovate = 0
    if arg.scena:
        # Foto "da tavolo": la carta va prima trovata e raddrizzata.
        scene = [simula_scena(Image.open(percorso_immagine(carte[i])), rng) for i in campione]
        inizio = time.time()
        foto = []
        for scena in scene:
            ritagliata, trovata = ritaglia_carta(scena)
            foto.append(ritagliata)
            trovate += trovata
    else:
        scene = None
        foto = [simula_foto(apri_carta(percorso_immagine(carte[i])), rng, forza=arg.forza) for i in campione]
        inizio = time.time()
    if arg.esempi:
        cartella = CARTELLA / 'esempi_foto'
        cartella.mkdir(exist_ok=True)
        for n, (i, immagine) in enumerate(zip(campione[:arg.esempi], foto)):
            if scene:
                # Scena e carta raddrizzata affiancate.
                scena = scene[n].resize((ALTEZZA * 3 // 4, ALTEZZA))
                affiancate = Image.new('RGB', (scena.width + LARGHEZZA + 10, ALTEZZA), 'white')
                affiancate.paste(scena, (0, 0))
                affiancate.paste(immagine, (scena.width + 10, 0))
                immagine = affiancate
            immagine.save(cartella / f"{carte[i]['id']}.jpg")
        print(f'Esempi di foto simulate in {cartella}')

    risultati = vota_due_versi(knn, indici, estrattore, foto, arg.k) if arg.scena else \
        vota(knn, indici, estrai_a_lotti(estrattore, foto, etichetta='foto simulate'), arg.k)
    durata = (time.time() - inizio) / len(foto) * 1000

    giuste = {'stampa top-1': 0, 'stampa top-5': 0, 'carta di gioco top-1': 0, 'carta di gioco top-5': 0}
    errori = []
    for vero, candidati in zip(campione, risultati):
        ids = [c for c, _ in candidati]
        chiavi = [carte[c]['chiave'] for c in ids]
        giuste['stampa top-1'] += ids[0] == vero
        giuste['stampa top-5'] += vero in ids
        giuste['carta di gioco top-1'] += chiavi[0] == carte[vero]['chiave']
        giuste['carta di gioco top-5'] += carte[vero]['chiave'] in chiavi
        if chiavi[0] != carte[vero]['chiave']:
            errori.append((vero, ids[0]))

    tipo = 'scene da tavolo con ritaglio automatico' if arg.scena else f'forza deformazione {arg.forza}'
    print(f'\nEstrattore {arg.estrattore}, k={arg.k}, {tipo}, {len(campione)} foto, {durata:.0f} ms a foto')
    if arg.scena:
        print(f'  carta trovata nella foto  {100 * trovate / len(campione):5.1f}%')
    for nome, valore in giuste.items():
        print(f'  {nome:<22} {100 * valore / len(campione):5.1f}%')
    if errori:
        print('\nAlcuni errori (vera → riconosciuta):')
        for vero, preso in errori[:10]:
            print(f"  {descrivi(carte[vero])}  →  {descrivi(carte[preso])}")


def descrivi(carta):
    return f"{carta['nome']} ({carta['sigla'] or carta['set']} {carta['numero']})"


# ════════════════════════════════════════════════════════════════════
# RICONOSCI
# ════════════════════════════════════════════════════════════════════
# La carta viene cercata e raddrizzata; la versione raddrizzata si salva
# accanto alla foto ("_ritaglio.jpg") per controllare a occhio.

def apri_foto(percorso):
    # Le foto del telefono salvano la rotazione nei dati EXIF; le HEIC
    # degli iPhone servono di pillow-heif (facoltativo).
    from PIL import ImageOps
    try:
        from pillow_heif import register_heif_opener
        register_heif_opener()
    except ImportError:
        pass
    return ImageOps.exif_transpose(Image.open(percorso))


def comando_riconosci(arg):
    knn, indici, carte = carica_modello(arg.estrattore)
    estrattore = ESTRATTORI[arg.estrattore]()
    for percorso in arg.foto:
        immagine = apri_foto(percorso)
        if arg.gia_ritagliata:
            carta, trovata = immagine.convert('RGB').resize((LARGHEZZA, ALTEZZA)), True
        else:
            carta, trovata = ritaglia_carta(immagine)
            carta.save(Path(percorso).with_name(Path(percorso).stem + '_ritaglio.jpg'))
        candidati = vota_due_versi(knn, indici, estrattore, [carta], arg.k)[0]
        print(f'\n{percorso}' + ('' if trovata else '  (carta non trovata: usata la foto intera)'))
        for posizione, (c, punteggio) in enumerate(candidati, 1):
            print(f'  {posizione}. {descrivi(carte[c]):<45} {100 * punteggio:5.1f}%')


# ════════════════════════════════════════════════════════════════════
# MAPPA
# ════════════════════════════════════════════════════════════════════
# I vettori hanno centinaia o migliaia di dimensioni: per vederli su un
# piano si proiettano in 2D (t-SNE, o PCA se si vuole una proiezione
# lineare). La proiezione conserva bene i vicini stretti ma deforma le
# distanze grandi: i "vicini veri" del KNN, calcolati nello spazio
# completo, si vedono cliccando una carta.
# Le foto passate con --foto finiscono sulla mappa come stelle, legate
# alle carte che il KNN ha scelto per loro.

def categoria(carta):
    if carta['tipo'] == 'Pokémon':
        return 'pokemon'
    return 'strumento' if 'Pokémon Tool' in carta['sottotipi'] else 'allenatore'


def comando_mappa(arg):
    knn, indici, carte = carica_modello(arg.estrattore)
    vettori = np.load(file_modello(arg.estrattore))['vettori']
    # Un punto per carta: l'immagine ufficiale (la prima delle sue righe).
    _, prime = np.unique(indici, return_index=True)
    originali = vettori[prime]

    # Vicini veri (spazio completo) di ogni carta, esclusa la carta stessa.
    distanze, vicini = knn.kneighbors(originali, n_neighbors=arg.k * (1 + 4) + 1)
    vicini_carte = []
    for i, (riga_d, riga_v) in enumerate(zip(distanze, vicini)):
        scelti = []
        for d, v in zip(riga_d, riga_v):
            c = int(indici[v])
            if c != i and c not in [s[0] for s in scelti]:
                scelti.append((c, round(float(1 - d), 3)))
            if len(scelti) == arg.k:
                break
        vicini_carte.append(scelti)

    foto = []
    if arg.foto:
        estrattore = ESTRATTORI[arg.estrattore]()
        for percorso in arg.foto:
            carta, _ = ritaglia_carta(apri_foto(percorso))
            vettore = estrai_a_lotti(estrattore, [carta])
            capovolto = estrai_a_lotti(estrattore, [carta.rotate(180)])
            if knn.kneighbors(capovolto, 1)[0][0, 0] < knn.kneighbors(vettore, 1)[0][0, 0]:
                vettore = capovolto
            candidati = vota(knn, indici, vettore, arg.k)[0]
            foto.append({'nome': Path(percorso).name, 'vettore': vettore[0],
                         'candidati': [[c, round(float(p), 3)] for c, p in candidati]})

    tutti = np.concatenate([originali] + [f['vettore'][None] for f in foto])
    print(f'Proiezione {arg.metodo} di {len(tutti)} punti...')
    inizio = time.time()
    if arg.metodo == 'pca':
        from sklearn.decomposition import PCA
        punti = PCA(n_components=2, random_state=arg.seme).fit_transform(tutti)
    else:
        from sklearn.decomposition import PCA
        from sklearn.manifold import TSNE
        # Prima una PCA a 50 dimensioni: t-SNE è più veloce e meno rumoroso.
        ridotti = PCA(n_components=min(50, tutti.shape[1]), random_state=arg.seme).fit_transform(tutti)
        punti = TSNE(n_components=2, metric='cosine', perplexity=30, init='pca',
                     random_state=arg.seme).fit_transform(ridotti)
    print(f'  {time.time() - inizio:.0f} s')
    punti = (punti - punti.min(axis=0)) / (punti.max(axis=0) - punti.min(axis=0)).max()

    dati = {
        'estrattore': arg.estrattore,
        'metodo': arg.metodo,
        'carte': [{'n': c['nome'], 's': c['sigla'] or c['set'], 'num': c['numero'], 'c': categoria(c),
                   'r': c.get('rarita', ''),
                   'img': c['immagine'], 'x': round(float(x), 5), 'y': round(float(y), 5),
                   'v': vicini_carte[i]}
                  for i, (c, (x, y)) in enumerate(zip(carte, punti[:len(carte)]))],
        'foto': [{'n': f['nome'], 'x': round(float(x), 5), 'y': round(float(y), 5), 'v': f['candidati']}
                 for f, (x, y) in zip(foto, punti[len(carte):])],
    }
    modello_html = (Path(__file__).resolve().parent / 'mappa.html').read_text()
    uscita = CARTELLA / f'mappa_{arg.estrattore}.html'
    uscita.write_text(modello_html.replace('/*DATI*/null', json.dumps(dati, ensure_ascii=False)))
    print(f'Mappa salvata in {uscita}')


# ════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description='Prova di riconoscimento delle carte con KNN')
    comandi = parser.add_subparsers(dest='comando', required=True)

    p = comandi.add_parser('scarica', help='scarica elenco e immagini delle carte Standard')
    p.add_argument('--lettere', default=LETTERE_STANDARD_PREDEFINITE, help='simboli di regolamento ammessi')

    for nome, aiuto in (('addestra', 'calcola i vettori delle carte'),
                        ('valuta', 'misura la precisione su foto simulate'),
                        ('riconosci', 'riconosce foto vere'),
                        ('mappa', 'disegna le carte su un piano (pagina HTML interattiva)')):
        p = comandi.add_parser(nome, help=aiuto)
        p.add_argument('--estrattore', choices=ESTRATTORI, default='cnn')
        p.add_argument('--seme', type=int, default=42)
        if nome == 'addestra':
            p.add_argument('--aumenti', type=int, default=2, help='copie deformate per carta')
            p.add_argument('--rarita', choices=('base', 'tutte'), default='base',
                           help='base = Common, Uncommon, Rare, Double Rare, ACE SPEC')
        else:
            p.add_argument('-k', type=int, default=5, help='vicini da considerare')
        if nome == 'valuta':
            p.add_argument('--campione', type=int, default=500)
            p.add_argument('--forza', type=float, default=1.0, help='quanto deformare le foto simulate')
            p.add_argument('--esempi', type=int, default=0, help='quante foto simulate salvare da guardare')
            p.add_argument('--scena', action='store_true',
                           help='foto "da tavolo" con ritaglio e raddrizzamento automatici')
        if nome == 'mappa':
            p.add_argument('--metodo', choices=('tsne', 'pca'), default='tsne')
            p.add_argument('--foto', nargs='*', default=[], help='foto da mostrare sulla mappa')
        if nome == 'riconosci':
            p.add_argument('foto', nargs='+')
            p.add_argument('--gia-ritagliata', action='store_true', help='non cercare la carta nella foto')

    arg = parser.parse_args()
    {'scarica': comando_scarica, 'addestra': comando_addestra,
     'valuta': comando_valuta, 'riconosci': comando_riconosci, 'mappa': comando_mappa}[arg.comando](arg)


if __name__ == '__main__':
    main()
