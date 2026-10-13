#!/usr/bin/env python3
# ════════════════════════════════════════════════════════════════════
# prova_ritaglio.py — RITAGLIO DELLA CARTA SU FOTO DIFFICILI
# ════════════════════════════════════════════════════════════════════
# Dal telefono il ritaglio sbaglia spesso. Qui si simulano le foto che
# lo mettono in crisi e si confrontano due strategie:
#   attuale  un solo contorno (trova_carta di knn_carte.py), se non lo
#            trova la foto intera;
#   multi    più ritagli candidati (diverse soglie e metodi, foto
#            intera, centro della foto) e vince quello la cui impronta
#            somiglia di più a una carta vera.
#
#   python prova_ritaglio.py [--campione 60] [--esempi 3]
# ════════════════════════════════════════════════════════════════════

import argparse
import json
import random
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

import knn_carte as k

RAPPORTO_CARTA = 63 / 88
# Una carta fotografata occupa almeno questa parte della foto: ritagli più
# piccoli sono pezzi di carta (un riquadro di testo) e ingannano il confronto.
AREA_MINIMA = 0.12


# ════════════════════════════════════════════════════════════════════
# FOTO DIFFICILI
# ════════════════════════════════════════════════════════════════════

TIPI_SCENA = ('normale', 'chiaro', 'vicino', 'mano', 'altre_carte', 'scuro_basso')


def scena(carta_rgba, rng, tipo, altre=()):
    L, A = 900, 1200
    if tipo == 'chiaro':
        # Tavolo bianco o grigio chiaro: il bordo argentato quasi sparisce.
        base = rng.uniform(205, 245) * np.ones(3) + rng.uniform(-8, 8, 3)
        venature = 4
    elif tipo == 'scuro_basso':
        base = rng.uniform(25, 60) * np.ones(3) + rng.uniform(-10, 10, 3)
        venature = 6
    else:
        base = rng.integers(40, 220, 3).astype(np.float32)
        venature = rng.uniform(8, 30)
    rumore = cv2.GaussianBlur(rng.normal(0, 1, (A // 6, L // 6)).astype(np.float32), (0, 0), rng.uniform(1, 3))
    sfondo = np.clip(base + cv2.resize(rumore, (L, A))[..., None] * venature, 0, 255).astype(np.float32)

    def appoggia(sopra, rgba, altezza, cx, cy, angolo):
        carta = np.asarray(rgba.convert('RGBA'), dtype=np.float32)
        h, w = carta.shape[:2]
        s = altezza / h
        rot = np.radians(angolo)
        origine = np.array([[0, 0], [w, 0], [w, h], [0, h]], dtype=np.float32) - [w / 2, h / 2]
        R = np.array([[np.cos(rot), -np.sin(rot)], [np.sin(rot), np.cos(rot)]])
        punti = origine * s @ R.T + [cx, cy] + rng.uniform(-0.05, 0.05, (4, 2)) * altezza
        M = cv2.getPerspectiveTransform(np.array([[0, 0], [w, 0], [w, h], [0, h]], dtype=np.float32),
                                        punti.astype(np.float32))
        d = cv2.warpPerspective(carta, M, (L, A))
        a = d[..., 3:] / 255
        return d[..., :3] * a + sopra * (1 - a)

    img = sfondo
    if tipo == 'altre_carte':
        # Altre carte vicine, in parte nell'inquadratura.
        for altra in altre[:2]:
            img = appoggia(img, altra, rng.uniform(0.5, 0.7) * A,
                           rng.choice([-0.1, 1.1]) * L + rng.uniform(-80, 80), rng.uniform(0.2, 0.8) * A,
                           rng.uniform(-20, 20))
    if tipo == 'vicino':
        altezza, cx, cy = rng.uniform(0.92, 1.08) * A, L / 2 + rng.uniform(-40, 40), A / 2 + rng.uniform(-40, 40)
    else:
        altezza, cx, cy = rng.uniform(0.5, 0.8) * A, L / 2 + rng.uniform(-90, 90), A / 2 + rng.uniform(-90, 90)
    img = appoggia(img, carta_rgba, altezza, cx, cy, rng.uniform(-12, 12))

    if tipo == 'mano':
        # Dito/mano color pelle che copre un pezzo di bordo.
        colore = np.array([rng.uniform(170, 230), rng.uniform(120, 170), rng.uniform(95, 140)])
        maschera = np.zeros((A, L), np.float32)
        x0 = int(cx + rng.choice([-1, 1]) * altezza * RAPPORTO_CARTA / 2)
        y0 = int(cy + rng.uniform(-0.3, 0.3) * altezza)
        cv2.ellipse(maschera, (x0, y0), (int(rng.uniform(60, 110)), int(rng.uniform(110, 180))),
                    rng.uniform(-30, 30), 0, 360, 1, -1)
        maschera = cv2.GaussianBlur(maschera, (0, 0), 6)[..., None]
        img = img * (1 - maschera) + colore * maschera

    yy, xx = np.mgrid[0:A, 0:L].astype(np.float32)
    luce = 0.85 if tipo == 'scuro_basso' else 1.0
    d = rng.uniform(-1, 1, 2)
    img = img * luce * (1 + 0.3 * (d[0] * (xx / L - 0.5) + d[1] * (yy / A - 0.5)))[..., None]
    if rng.random() < 0.6:
        gx, gy, r = rng.uniform(0.3, 0.7) * L, rng.uniform(0.3, 0.7) * A, rng.uniform(0.06, 0.18) * L
        img += (np.clip(1 - np.hypot(xx - gx, yy - gy) / r, 0, 1) * 150)[..., None]
    img = cv2.GaussianBlur(np.clip(img, 0, 255), (0, 0), rng.uniform(0.6, 1.8))
    img += rng.normal(0, 4 if tipo != 'scuro_basso' else 9, img.shape)
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))


# ════════════════════════════════════════════════════════════════════
# RITAGLI CANDIDATI
# ════════════════════════════════════════════════════════════════════

def quadrilateri(binaria, area_foto, area_minima=AREA_MINIMA):
    """Contorni di un'immagine binaria → quadrilateri con forma da carta."""
    contorni, _ = cv2.findContours(binaria, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    trovati = []
    for contorno in sorted(contorni, key=cv2.contourArea, reverse=True)[:4]:
        involucro = cv2.convexHull(contorno)
        if cv2.contourArea(involucro) < area_minima * area_foto:
            break
        perimetro = cv2.arcLength(involucro, True)
        quattro = None
        for tolleranza in (0.02, 0.03, 0.04, 0.06):
            approssimato = cv2.approxPolyDP(involucro, tolleranza * perimetro, True)
            if len(approssimato) == 4:
                quattro = approssimato
                break
        if quattro is None:
            quattro = cv2.boxPoints(cv2.minAreaRect(involucro))
        angoli = k.ordina_angoli(quattro)
        larghezza = (np.linalg.norm(angoli[0] - angoli[1]) + np.linalg.norm(angoli[3] - angoli[2])) / 2
        altezza = (np.linalg.norm(angoli[1] - angoli[2]) + np.linalg.norm(angoli[0] - angoli[3])) / 2
        if 0.5 < larghezza / max(altezza, 1) < 0.95:
            trovati.append(angoli)
    return trovati


def candidati(immagine):
    """Più ritagli possibili della stessa foto, come quadrilateri (angoli)."""
    rgb = np.asarray(immagine.convert('RGB'))
    scala = min(1, 800 / max(rgb.shape[:2]))
    piccola = cv2.resize(rgb, None, fx=scala, fy=scala, interpolation=cv2.INTER_AREA)
    h, w = piccola.shape[:2]
    area = h * w
    grigio = cv2.GaussianBlur(cv2.cvtColor(piccola, cv2.COLOR_RGB2GRAY), (5, 5), 0)
    hsv = cv2.cvtColor(piccola, cv2.COLOR_RGB2HSV)
    nucleo = np.ones((5, 5), np.uint8)
    quad = []

    # 1. Bordi da luminosità e colore (il metodo attuale).
    bordi = cv2.Canny(grigio, 30, 100)
    for canale in cv2.split(hsv)[:2]:
        bordi |= cv2.Canny(cv2.GaussianBlur(canale, (5, 5), 0), 40, 120)
    quad += quadrilateri(cv2.morphologyEx(bordi, cv2.MORPH_CLOSE, nucleo, iterations=2), area)

    # 2. Bordi con soglie automatiche (dalla mediana), più sensibili.
    mediana = float(np.median(grigio))
    deboli = cv2.Canny(grigio, int(max(5, 0.4 * mediana)), int(max(20, 0.9 * mediana)))
    quad += quadrilateri(cv2.dilate(cv2.morphologyEx(deboli, cv2.MORPH_CLOSE, nucleo, iterations=3), nucleo), area)

    # 3. Soglia di Otsu su luminosità e saturazione, nei due versi.
    for canale in (grigio, cv2.GaussianBlur(hsv[..., 1], (5, 5), 0)):
        _, binaria = cv2.threshold(canale, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        for b in (binaria, 255 - binaria):
            b = cv2.morphologyEx(b, cv2.MORPH_OPEN, nucleo, iterations=2)
            quad += quadrilateri(b, area)

    # 4. Differenza dal tavolo: il colore dello sfondo si stima dalla
    #    cornice esterna della foto; la carta è ciò che se ne discosta.
    lab = cv2.cvtColor(cv2.GaussianBlur(piccola, (7, 7), 0), cv2.COLOR_RGB2LAB).astype(np.float32)
    bordo = max(4, int(0.03 * min(h, w)))
    cornice = np.concatenate([lab[:bordo].reshape(-1, 3), lab[-bordo:].reshape(-1, 3),
                              lab[:, :bordo].reshape(-1, 3), lab[:, -bordo:].reshape(-1, 3)])
    distanza = np.linalg.norm(lab - np.median(cornice, axis=0), axis=2)
    distanza = np.clip(distanza * (255 / max(np.percentile(distanza, 99), 1)), 0, 255).astype(np.uint8)
    _, binaria = cv2.threshold(distanza, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    binaria = cv2.morphologyEx(binaria, cv2.MORPH_CLOSE, nucleo, iterations=3)
    binaria = cv2.morphologyEx(binaria, cv2.MORPH_OPEN, nucleo, iterations=2)
    quad += quadrilateri(binaria, area)

    # 5. Senza bordi: la foto intera e il centro con le proporzioni di una
    #    carta (chi fotografa di solito la mette in mezzo).
    quad.append(np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], dtype=np.float32))
    for frazione in (0.9, 0.75):
        a = frazione * min(h, w / RAPPORTO_CARTA)
        l = a * RAPPORTO_CARTA
        x0, y0 = (w - l) / 2, (h - a) / 2
        quad.append(np.array([[x0, y0], [x0 + l, y0], [x0 + l, y0 + a], [x0, y0 + a]], dtype=np.float32))

    # Doppioni: angoli entro il 3% del lato lungo.
    unici = []
    for q in quad:
        if all(np.abs(q - u).max() > 0.03 * max(h, w) for u in unici):
            unici.append(q)
    return [q / scala for q in unici]


# ════════════════════════════════════════════════════════════════════
# CONFRONTO
# ════════════════════════════════════════════════════════════════════

def migliore(vettori, riferimento):
    """Per ogni vettore: (similarità migliore, indice carta)."""
    sim = vettori @ riferimento.T
    return sim.max(axis=1), sim.argmax(axis=1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--campione', type=int, default=60, help='foto per tipo di scena')
    parser.add_argument('--esempi', type=int, default=0, help='scene da salvare per tipo')
    arg = parser.parse_args()

    dati = np.load(k.file_modello('pixel'))
    carte_per_id = {c['id']: c for c in k.leggi_carte()}
    carte = [carte_per_id[i] for i in dati['id']]
    _, prime = np.unique(dati['indici'], return_index=True)
    riferimento = dati['vettori'][prime]
    estrattore = k.EstrattorePixel()
    rng = np.random.default_rng(7)
    scelta = random.Random(7)

    cartella = k.CARTELLA / 'esempi_ritaglio'
    if arg.esempi:
        cartella.mkdir(exist_ok=True)

    print(f'{"scena":<13} {"attuale":>8} {"multi":>8} {"candidati":>10}')
    totali = {'attuale': 0, 'multi': 0, 'n': 0}
    for tipo in TIPI_SCENA:
        giuste = {'attuale': 0, 'multi': 0}
        numero_candidati = []
        for n in range(arg.campione):
            i = scelta.randrange(len(carte))
            altre = [Image.open(k.percorso_immagine(carte[scelta.randrange(len(carte))])) for _ in range(2)]
            foto = scena(Image.open(k.percorso_immagine(carte[i])), rng, tipo, altre)
            vera = carte[i]['chiave']

            # Attuale.
            ritaglio, _ = k.ritaglia_carta(foto)
            v = estrattore([ritaglio, ritaglio.rotate(180)])
            s, c = migliore(v, riferimento)
            giuste['attuale'] += carte[c[s.argmax()]]['chiave'] == vera

            # Multi.
            ritagli = [k.raddrizza(foto, q) for q in candidati(foto)]
            numero_candidati.append(len(ritagli))
            v = estrattore(ritagli + [r.rotate(180) for r in ritagli])
            s, c = migliore(v, riferimento)
            giuste['multi'] += carte[c[s.argmax()]]['chiave'] == vera

            if n < arg.esempi:
                scelto = ritagli[s.argmax() % len(ritagli)]
                tela = Image.new('RGB', (300 + 3 * 224, 400), 'white')
                tela.paste(foto.resize((300, 400)), (0, 0))
                tela.paste(ritaglio, (300, 0))
                tela.paste(scelto, (300 + 224 + 10, 0))
                tela.save(cartella / f'{tipo}_{n}.jpg')
        print(f'{tipo:<13} {100 * giuste["attuale"] / arg.campione:7.0f}% {100 * giuste["multi"] / arg.campione:7.0f}%'
              f' {np.mean(numero_candidati):10.1f}')
        totali['attuale'] += giuste['attuale']
        totali['multi'] += giuste['multi']
        totali['n'] += arg.campione
    print(f'{"TOTALE":<13} {100 * totali["attuale"] / totali["n"]:7.0f}% {100 * totali["multi"] / totali["n"]:7.0f}%')


if __name__ == '__main__':
    main()
