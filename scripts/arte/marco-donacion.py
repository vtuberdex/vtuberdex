#!/usr/bin/env python3
# Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
"""
Genera `components/marcos/donacion.webp`: la filigrana dorada ORIGINAL del marco de las cartas gradeadas por donación.

Estilo pedido por el mantenedor (boceto): hoja negra con un marco de oro ornamentado: doble filete, volutas en las
esquinas, anillos a los costados y un medallón arriba y abajo. El boceto era solo una guía de estilo; el dibujo es nuestro
y sale de este script, así que es reproducible y se puede afinar (todas las medidas están arriba) en vez de ser un
archivo opaco. El artista puede sustituir el resultado por su versión final con el mismo contrato (ver `premium-marco-arte.ts`).

Uso (necesita Pillow y numpy):   python3 scripts/arte/marco-donacion.py
Resultado: PNG/WebP con alfa, 640 x 1036 (proporción 1 : 1,62 de la placa). Solo hay oro: el interior queda transparente y
el negro lo pone la hoja (`insert.frame`).

CÓMO SE DIBUJA
 · Todo se traza en una máscara (L) a 3x y se baja con LANCZOS: bordes limpios sin dibujar a mano el antialias.
 · Los trazos son POLÍGONOS de ancho variable (`trazo`): una línea de contorno con grosor que va de `w0` a `w1`, que es lo que
   da el aire de pluma de caligrafía (un `line()` de ancho fijo se vería técnico).
 · El oro es un degradado metálico en bandas diagonales con un brillo estrecho, no un color liso.
"""
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

# ---- Medidas (en px del lienzo BASE de 988 x 1600; todo se escala solo) -------------------------------------------------
W, H = 988, 1600
SS = 3  # supersampling
SALIDA = (640, 1036)

BANDA = 66  # el adorno vive en este margen exterior (≈ 7 % del ancho): lo de dentro lo tapan la etiqueta y la ventana
FILETE_EXT = (12, 4.4)  # (inset, grosor) del filete exterior
FILETE_INT = (23, 1.8)  # idem del interior
EJE = 36  # línea central de las enredaderas dentro de la banda
GAP_MEDALLON = 62  # medio ancho que los filetes dejan libre alrededor de un medallón

ORO = [  # (posición 0..1, color) a lo largo del degradado metálico
    (0.00, (110, 78, 22)),
    (0.18, (206, 162, 62)),
    (0.34, (250, 226, 138)),
    (0.42, (255, 247, 205)),  # brillo
    (0.52, (232, 196, 96)),
    (0.72, (150, 108, 34)),
    (0.86, (214, 172, 70)),
    (1.00, (110, 78, 22)),
]


def s(v):
    return v * SS


def trazo(draw, pts, w0, w1, caps=True):
    """Polígono de ancho variable sobre la línea `pts` (lista de (x, y)); el ancho va de w0 a w1 a lo largo del trazo."""
    n = len(pts)
    if n < 2:
        return
    izq, der = [], []
    for i, (x, y) in enumerate(pts):
        a = pts[max(i - 1, 0)]
        b = pts[min(i + 1, n - 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        ln = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / ln, dx / ln
        t = i / (n - 1)
        w = (w0 + (w1 - w0) * t) / 2
        izq.append((s(x + nx * w), s(y + ny * w)))
        der.append((s(x - nx * w), s(y - ny * w)))
    draw.polygon(izq + der[::-1], fill=255)
    if caps:
        for (x, y), w in ((pts[0], w0), (pts[-1], w1)):
            r = max(w / 2, 0.3)
            draw.ellipse((s(x - r), s(y - r), s(x + r), s(y + r)), fill=255)


def punto(draw, x, y, r):
    draw.ellipse((s(x - r), s(y - r), s(x + r), s(y + r)), fill=255)


def anillo(draw, x, y, r, grosor):
    draw.ellipse((s(x - r), s(y - r), s(x + r), s(y + r)), outline=255, width=max(1, round(s(grosor))))


def rombo(draw, x, y, ancho, alto, relleno=True, grosor=1.6):
    pts = [(s(x), s(y - alto / 2)), (s(x + ancho / 2), s(y)), (s(x), s(y + alto / 2)), (s(x - ancho / 2), s(y))]
    if relleno:
        draw.polygon(pts, fill=255)
    else:
        draw.line(pts + [pts[0]], fill=255, width=max(1, round(s(grosor))), joint="curve")


def hoja(draw, cx, cy, largo, ancho, angulo):
    """Hoja en forma de lente (dos arcos) centrada en (cx, cy) y apuntando a `angulo` (radianes)."""
    ca, sa = math.cos(angulo), math.sin(angulo)
    pts = []
    for k in range(0, 21):
        t = k / 20
        u = (t - 0.5) * largo
        v = math.sin(t * math.pi) * ancho / 2
        pts.append((cx + u * ca - v * sa, cy + u * sa + v * ca))
    for k in range(20, -1, -1):
        t = k / 20
        u = (t - 0.5) * largo
        v = -math.sin(t * math.pi) * ancho / 2
        pts.append((cx + u * ca - v * sa, cy + u * sa + v * ca))
    draw.polygon([(s(x), s(y)) for x, y in pts], fill=255)


def espiral(cx, cy, r0, r1, vueltas, ang0, sentido, n=140):
    """Puntos de una espiral que parte a radio r0 y ángulo ang0 y se cierra hasta r1. sentido = +1 horario en pantalla."""
    pts = []
    for i in range(n + 1):
        t = i / n
        r = r0 + (r1 - r0) * (t**0.85)
        a = ang0 + sentido * vueltas * 2 * math.pi * t
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def enredadera_superior(x_ini, x_fin, y, amplitud, longitud_onda):
    """Línea ondulada de x_ini a x_fin (puede ser decreciente) cuya onda se apaga en x_ini (para empalmar con la voluta)."""
    n = 120
    pts = []
    for i in range(n + 1):
        t = i / n
        x = x_ini + (x_fin - x_ini) * t
        env = t  # 0 donde empalma con la voluta, 1 lejos
        pts.append((x, y + amplitud * env * math.sin(2 * math.pi * (x - x_ini) / longitud_onda)))
    return pts


def esquina_superior_izquierda(draw):
    """Voluta de una esquina (las otras tres son espejos): dos espirales, una por cada enredadera, y sus hojas."""
    R = 21
    # Enredadera de arriba -> voluta que gira en sentido antihorario (entra por la parte alta, hacia la izquierda).
    cx1, cy1 = 104, EJE + R - 2
    cola = enredadera_superior(430, cx1, EJE - 2, 3.0, 150)  # de lejos (fina) hacia la voluta (gruesa)
    # El trazo se dibuja de la voluta hacia fuera para que el ancho vaya de grueso a fino.
    esp = espiral(cx1, cy1, R, 4.5, 1.55, -math.pi / 2, -1)
    cuerpo = esp[::-1] + cola[::-1]  # del centro de la espiral, saliendo, hasta la punta lejana
    # Se recorre desde el centro de la voluta: ancho fino en el centro, máximo en la boca, y otra vez fino en la punta.
    corte = len(esp)
    trazo(draw, cuerpo[:corte], 2.0, 6.6, caps=True)
    trazo(draw, cuerpo[corte - 1 :], 6.6, 0.8, caps=True)

    # Enredadera lateral: la misma pieza espejada sobre la diagonal.
    cola2 = [(y, x) for (x, y) in cola]
    esp2 = [(y, x) for (x, y) in esp]
    cuerpo2 = esp2[::-1] + cola2[::-1]
    trazo(draw, cuerpo2[:corte], 2.0, 6.6, caps=True)
    trazo(draw, cuerpo2[corte - 1 :], 6.6, 0.8, caps=True)

    # Hojas a lo largo de cada enredadera, alternando lados.
    for k, x in enumerate((176, 238, 300, 362)):
        lado = -1 if k % 2 == 0 else 1
        y = EJE - 2 + 3.0 * ((x - 104) / 326) * math.sin(2 * math.pi * (x - 104 - 0) / 150)
        largo = 30 - k * 3
        ang = math.radians(-32 * lado) if lado < 0 else math.radians(32)
        hoja(draw, x, y + lado * 7, largo, 8.5 - k * 0.6, ang)
        hoja(draw, y + lado * 7, x, largo, 8.5 - k * 0.6, math.pi / 2 - ang)

    # El diamante de la esquina y unas motas.
    rombo(draw, 40, 40, 17, 17)
    for dx, dy in ((26, 40), (54, 40), (40, 26), (40, 54)):
        punto(draw, dx, dy, 1.9)
    punto(draw, 70, 20, 1.4)
    punto(draw, 20, 70, 1.4)


def medallon_horizontal(draw, cx, y):
    """Adorno central de arriba/abajo: rombo con ojo, dos hojas y dos filetes finos que mueren hacia las enredaderas."""
    rombo(draw, cx, y, 34, 24, relleno=False, grosor=3.4)
    rombo(draw, cx, y, 12, 9)
    for lado in (-1, 1):
        hoja(draw, cx + lado * 38, y, 28, 9, 0 if lado > 0 else math.pi)
        trazo(draw, [(cx + lado * 54, y), (cx + lado * 120, y)], 3.2, 0.7)
        punto(draw, cx + lado * 132, y, 1.8)
        punto(draw, cx + lado * 146, y, 1.1)


def medallon_lateral(draw, x, cy):
    """Adorno central de los costados: anillo doble con ojo, rombos arriba y abajo y filetes que mueren hacia las volutas."""
    anillo(draw, x, cy, 14.5, 3.6)
    anillo(draw, x, cy, 7.2, 1.6)
    punto(draw, x, cy, 2.6)
    for lado in (-1, 1):
        rombo(draw, x, cy + lado * 32, 8, 12)
        trazo(draw, [(x, cy + lado * 44), (x, cy + lado * 300)], 3.4, 0.7)
        punto(draw, x, cy + lado * 312, 1.8)
        punto(draw, x, cy + lado * 326, 1.1)


def filetes(draw):
    """Doble filete: continuo en el contorno, con un hueco alrededor de cada medallón y esquinas redondeadas."""
    for inset, grosor in (FILETE_EXT, FILETE_INT):
        w = max(1, round(s(grosor)))
        x0, y0, x1, y1 = inset, inset, W - inset, H - inset
        r = 38 - (inset - FILETE_EXT[0]) * 0.6
        tramos = [
            # arriba: izquierda y derecha del medallón
            ((x0 + r, y0), (W / 2 - GAP_MEDALLON, y0)),
            ((W / 2 + GAP_MEDALLON, y0), (x1 - r, y0)),
            # abajo
            ((x0 + r, y1), (W / 2 - GAP_MEDALLON, y1)),
            ((W / 2 + GAP_MEDALLON, y1), (x1 - r, y1)),
            # izquierda y derecha: arriba y abajo del medallón
            ((x0, y0 + r), (x0, H / 2 - GAP_MEDALLON)),
            ((x0, H / 2 + GAP_MEDALLON), (x0, y1 - r)),
            ((x1, y0 + r), (x1, H / 2 - GAP_MEDALLON)),
            ((x1, H / 2 + GAP_MEDALLON), (x1, y1 - r)),
        ]
        for (ax, ay), (bx, by) in tramos:
            draw.line((s(ax), s(ay), s(bx), s(by)), fill=255, width=w)
        for (ex, ey, a0) in ((x0, y0, 180), (x1, y0, 270), (x1, y1, 0), (x0, y1, 90)):
            cx = ex + (r if ex == x0 else -r)
            cy = ey + (r if ey == y0 else -r)
            draw.arc((s(cx - r), s(cy - r), s(cx + r), s(cy + r)), a0, a0 + 90, fill=255, width=w)


def dibujar():
    mascara = Image.new("L", (s(W), s(H)), 0)
    d = ImageDraw.Draw(mascara)
    filetes(d)

    # Esquina arriba-izquierda y sus tres espejos: se dibuja una vez en un lienzo y se refleja.
    cuarto = Image.new("L", (s(W), s(H)), 0)
    esquina_superior_izquierda(ImageDraw.Draw(cuarto))
    espejos = [
        cuarto,
        cuarto.transpose(Image.FLIP_LEFT_RIGHT),
        cuarto.transpose(Image.FLIP_TOP_BOTTOM),
        cuarto.transpose(Image.ROTATE_180),
    ]
    for e in espejos:
        mascara = Image.fromarray(np.maximum(np.asarray(mascara), np.asarray(e)))
    d = ImageDraw.Draw(mascara)

    medallon_horizontal(d, W / 2, EJE - 2)
    medallon_horizontal(d, W / 2, H - (EJE - 2))
    medallon_lateral(d, EJE - 2, H / 2)
    medallon_lateral(d, W - (EJE - 2), H / 2)
    return mascara


def degradado_oro(ancho, alto):
    """Oro metálico: bandas diagonales con un brillo estrecho, repetidas para que la luz «recorra» la pieza."""
    yy, xx = np.mgrid[0:alto, 0:ancho].astype(np.float32)
    t = ((xx * 0.42 + yy * 0.58) / (ancho * 0.42 + alto * 0.58)) * 2.6 % 1.0
    pos = [p for p, _ in ORO]
    out = np.zeros((alto, ancho, 3), np.float32)
    for c in range(3):
        out[..., c] = np.interp(t, pos, [col[c] for _, col in ORO])
    return out


def main():
    destino = Path(__file__).resolve().parents[2] / "components" / "marcos" / "donacion.webp"
    mascara = dibujar().filter(ImageFilter.GaussianBlur(0.35 * SS / 3))
    mascara = mascara.resize((W, H), Image.LANCZOS)

    oro = degradado_oro(W, H)
    alfa = np.asarray(mascara, np.float32)

    # Relieve: un reborde claro arriba-izquierda y oscuro abajo-derecha da volumen al trazo.
    relieve = np.asarray(mascara.filter(ImageFilter.GaussianBlur(1.6)), np.float32)
    luz = np.clip((np.roll(relieve, 2, axis=(0, 1)) - relieve) * 0.9, -60, 60)[..., None]
    rgb = np.clip(oro - luz, 0, 255)

    rgba = np.dstack([rgb, alfa]).astype(np.uint8)
    img = Image.fromarray(rgba, "RGBA").resize(SALIDA, Image.LANCZOS)
    img.save(destino, "WEBP", quality=90, method=6)
    vista = Path("/tmp/vis/marco-original.png")
    if vista.parent.exists():
        fondo = Image.new("RGBA", SALIDA, (13, 13, 16, 255))
        fondo.alpha_composite(img)
        fondo.convert("RGB").save(vista)
    print("ok", destino, img.size, destino.stat().st_size, "bytes")


if __name__ == "__main__":
    sys.exit(main())
