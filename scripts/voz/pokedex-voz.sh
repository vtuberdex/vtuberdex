#!/usr/bin/env bash
# Voz «Pokédex» definitiva (variante C), la que usa `scripts/voces-generar.mjs`: aguda, metálica y digital, con pitidos de arranque y de cierre.
# Uso: pokedex-voz.sh entrada.wav salida.mp3
#   inicio: blip-blip (1320/1760 Hz) + blip-blip más agudo (1568/2093 Hz)
#   final:  blip, blip descendente (1760 → 1320 Hz)
set -euo pipefail
P=1.30      # altura (+30 %), conserva la velocidad; sube también el timbre
F=110       # portadora del anillo (zumbido metálico)
B=6; M=4    # bitcrush: bits y reducción de muestreo

args=(-i "$1" -f lavfi -i "sine=f=$F:sample_rate=22050:d=90")
n=2
# `sine` de ffmpeg sale con amplitud 1/8 (-18 dBFS): con volume=2.8 el pitido queda en ~-9 dB, claramente
# audible junto a una voz con pico de ~-4.7 dB. Con 0.25 (la primera versión) salía a -30 dB: casi inaudible.
fb=""
bip() {  # frecuencia → entrada de 70 ms (con fundidos para que no chasquee). SIN subshell:
         # tiene que modificar `args`, `fb` y `n` del script.
  args+=(-f lavfi -t 0.07 -i "sine=f=$1:sample_rate=22050")
  fb+="[$n:a]volume=2.8,afade=t=in:d=0.004,afade=t=out:st=0.05:d=0.02[b$n];"
  n=$((n+1))
}
for f in 1320 1760 1568 2093 1760 1320; do bip "$f"; done
# b2..b7: inicio (b2,b3 | b4,b5) y final (b6,b7)
ffmpeg -y -loglevel error "${args[@]}" -filter_complex "
  [0:a]asetrate=22050*$P,aresample=22050,atempo=1/$P,
       highpass=f=450,lowpass=f=3600,asplit=2[seca][anillo];
  [anillo][1:a]amultiply,volume=2.4[mod];
  [seca][mod]amix=inputs=2:weights=0.5 0.65:normalize=0,
       acrusher=bits=$B:samples=$M:mode=log:aa=0:mix=0.8,
       aecho=0.85:0.8:3|5|9:0.6|0.5|0.35,
       acompressor=threshold=-22dB:ratio=10:attack=3:release=40,
       volume=2.6,alimiter=limit=0.9[voz];
  $fb
  aevalsrc=0:d=0.06:s=22050[s1];
  aevalsrc=0:d=0.12:s=22050[s2];
  aevalsrc=0:d=0.06:s=22050[s3];
  aevalsrc=0:d=0.14:s=22050[s4];
  aevalsrc=0:d=0.18:s=22050[s5];
  aevalsrc=0:d=0.09:s=22050[s6];
  [b2][s1][b3][s2][b4][s3][b5][s4][voz][s5][b6][s6][b7]concat=n=13:v=0:a=1[out]" \
  -map "[out]" -ac 1 -codec:a libmp3lame -b:a 64k "$2"
