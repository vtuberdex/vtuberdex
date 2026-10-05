#!/usr/bin/env node
/**
 * Genera el audio de cada ficha: «Nombre. País. Historia.» con Piper (voz femenina española)
 * y el filtro de `scripts/voz/pokedex-voz.sh` (altavoz metálico, bitcrush, pitidos).
 *
 *   node scripts/voces-generar.mjs --todas          lote completo (reanudable: salta lo que no cambió)
 *   node scripts/voces-generar.mjs --slug=madkoding una ficha
 *   node scripts/voces-generar.mjs --cola           procesa la cola una vez y sale
 *   node scripts/voces-generar.mjs --vigilar        servicio: procesa la cola para siempre
 *   node scripts/voces-generar.mjs --limpiar        borra clips de fichas que ya no tienen voz
 *   --forzar    regenera aunque el guion no haya cambiado       --seco   no escribe nada, solo informa
 *   --limite=N  solo las N primeras (para probar)
 *
 * Cada `<slug>.mp3` lleva un `<slug>.txt` con el guion con que se generó: así se sabe si una
 * edición realmente cambió lo que se dice y no se regenera en balde (el lote tarda ~1 hora).
 *
 * Entorno: VTUBERDEX_VOCES_DIR (obligatoria), VTUBERDEX_PIPER_PYTHON (Python con piper-tts),
 * VTUBERDEX_PIPER_MODELO (.onnx), TURSO_DATABASE_URL (la base con las ediciones del mantenedor).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { dbConDiario } from '../lib/diario.mjs';
import { guionDeFicha } from '../lib/voz-guion.mjs';
import { leerCola, quitarDeCola } from '../lib/voces-cola.mjs';
import { getVtuberBySlug, searchVtubers } from '../server/src/search.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const HOME = os.homedir();
const CARPETA = process.env.VTUBERDEX_VOCES_DIR;
const PYTHON = process.env.VTUBERDEX_PIPER_PYTHON || path.join(HOME, 'voces/venv/bin/python');
const MODELO = process.env.VTUBERDEX_PIPER_MODELO || path.join(HOME, 'voces/modelos/es_ES-sharvard-medium.onnx');
const FILTRO = path.join(AQUI, 'voz/pokedex-voz.sh');
/** `sharvard` trae dos voces: 0 = masculina, 1 = femenina. */
const HABLANTE = '1';
const TIEMPO_MAX_MS = 120_000;
const SONDEO_COLA_MS = 5_000;

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const valor = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];
const SECO = flag('seco');
const FORZAR = flag('forzar');

function ejecutar(cmd, argv, opciones = {}) {
  return new Promise((resolve, reject) => {
    const hijo = spawn(cmd, argv, { stdio: ['ignore', 'ignore', 'pipe'], ...opciones });
    let err = '';
    hijo.stderr.on('data', (d) => (err += d));
    const reloj = setTimeout(() => hijo.kill('SIGKILL'), TIEMPO_MAX_MS);
    hijo.on('error', reject);
    hijo.on('close', (codigo) => {
      clearTimeout(reloj);
      if (codigo === 0) resolve();
      else reject(new Error(`${path.basename(cmd)} salió con ${codigo}: ${err.trim().split('\n').slice(-3).join(' | ')}`));
    });
  });
}

const rutas = (slug) => ({ mp3: path.join(CARPETA, `${slug}.mp3`), txt: path.join(CARPETA, `${slug}.txt`) });

/** Genera (o conserva, o retira) el clip de UNA ficha. Devuelve 'generada' | 'sin_cambios' | 'retirada' | motivo. */
async function procesar(ficha) {
  const { texto, motivo } = guionDeFicha(ficha);
  const { mp3, txt } = rutas(ficha.slug);
  if (!texto) {
    // Sin guion (se borró la historia, cambió el idioma…): un clip viejo diría algo que ya no es cierto.
    if (fs.existsSync(mp3)) {
      if (!SECO) {
        fs.rmSync(mp3, { force: true });
        fs.rmSync(txt, { force: true });
      }
      return 'retirada';
    }
    return motivo;
  }
  if (!FORZAR && fs.existsSync(mp3) && fs.existsSync(txt) && fs.readFileSync(txt, 'utf8') === texto) return 'sin_cambios';
  if (SECO) return 'generada';

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'voz-'));
  try {
    fs.writeFileSync(path.join(tmp, 'guion.txt'), `${texto}\n`);
    // noise-scale / noise-w bajos = entonación y ritmo planos (más «aparato» y menos humana).
    await ejecutar(PYTHON, ['-m', 'piper', '-m', MODELO, '-s', HABLANTE, '--noise-scale', '0.15', '--noise-w-scale', '0.15', '--length-scale', '1.05', '-i', path.join(tmp, 'guion.txt'), '-f', path.join(tmp, 'voz.wav')]);
    await ejecutar('bash', [FILTRO, path.join(tmp, 'voz.wav'), path.join(tmp, 'voz.mp3')]);
    fs.mkdirSync(CARPETA, { recursive: true });
    fs.copyFileSync(path.join(tmp, 'voz.mp3'), `${mp3}.tmp`);
    fs.renameSync(`${mp3}.tmp`, mp3); // atómico: la ruta /voces nunca sirve un MP3 a medias
    fs.writeFileSync(txt, texto);
    return 'generada';
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function fichasPublicadas(db) {
  const todas = [];
  for (let pagina = 1; ; pagina += 1) {
    const r = searchVtubers(db, { sort: 'dex', page: pagina, perPage: 100 });
    todas.push(...r.items);
    if (pagina >= r.pageCount) break;
  }
  return todas;
}

const resumen = new Map();
const contar = (r) => resumen.set(r, (resumen.get(r) ?? 0) + 1);
const hora = () => new Date().toLocaleTimeString('es-CL');

async function lote(db, fichas, etiqueta) {
  let n = 0;
  for (const f of fichas) {
    n += 1;
    const t0 = Date.now();
    let r;
    try {
      r = await procesar(f);
    } catch (e) {
      r = 'error';
      console.error(`[${hora()}] ✖ ${f.slug}: ${e.message}`);
    }
    contar(r);
    if (r !== 'sin_cambios' || n % 50 === 0) console.log(`[${hora()}] ${etiqueta} ${n}/${fichas.length} ${f.slug}: ${r}${r === 'generada' ? ` (${((Date.now() - t0) / 1000).toFixed(1)} s)` : ''}`);
  }
}

/** Borra los clips de fichas que ya no existen (renombradas, borradores) o ya no tienen guion. */
async function limpiar(db) {
  const vigentes = new Set();
  for (const f of await fichasPublicadas(db)) if (guionDeFicha(f).texto) vigentes.add(f.slug);
  let borrados = 0;
  for (const archivo of fs.existsSync(CARPETA) ? fs.readdirSync(CARPETA) : []) {
    const m = /^(.+)\.(mp3|txt)$/.exec(archivo);
    if (m && !vigentes.has(m[1])) {
      if (!SECO) fs.rmSync(path.join(CARPETA, archivo), { force: true });
      borrados += 1;
    }
  }
  console.log(`[${hora()}] limpieza: ${borrados} archivo(s) huérfano(s)${SECO ? ' (seco)' : ' borrados'}`);
}

/** Procesa los trabajos de la cola; la ficha se lee de la base de AHORA (con el diario aplicado). */
async function procesarCola() {
  const trabajos = leerCola();
  if (!trabajos.length) return 0;
  const db = await dbConDiario();
  for (const t of trabajos) {
    const ficha = getVtuberBySlug(db, t.slug, { includeHidden: true });
    let r = 'sin_ficha';
    if (ficha) {
      // Oculta o en borrador no tiene página: su clip no debe servirse.
      r = ficha.status && ficha.status !== 'published' ? await procesar({ ...ficha, cardText: '' }) : await procesar(ficha);
    }
    console.log(`[${hora()}] cola: ${t.slug} → ${r}`);
    quitarDeCola(t);
  }
  return trabajos.length;
}

async function main() {
  if (!CARPETA) {
    console.error('✖ falta VTUBERDEX_VOCES_DIR (carpeta donde se guardan los clips).');
    process.exit(1);
  }
  if (!SECO) fs.mkdirSync(CARPETA, { recursive: true });

  if (flag('vigilar')) {
    console.log(`[${hora()}] vigilando ${path.join(CARPETA, '.cola')} cada ${SONDEO_COLA_MS / 1000} s`);
    let parar = false;
    for (const senal of ['SIGTERM', 'SIGINT']) {
      process.on(senal, () => {
        parar = true;
      });
    }
    while (!parar) {
      try {
        await procesarCola();
      } catch (e) {
        console.error(`[${hora()}] ✖ cola: ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, SONDEO_COLA_MS));
    }
    return;
  }

  const db = await dbConDiario();
  if (flag('cola')) await procesarCola();
  else if (valor('slug')) {
    const f = getVtuberBySlug(db, valor('slug'), { includeHidden: true });
    if (!f) throw new Error(`no existe la ficha ${valor('slug')}`);
    await lote(db, [f], 'ficha');
  } else if (flag('todas')) {
    let fichas = await fichasPublicadas(db);
    if (valor('limite')) fichas = fichas.slice(0, Number(valor('limite')));
    console.log(`[${hora()}] ${fichas.length} fichas publicadas${SECO ? ' (seco)' : ''}${FORZAR ? ' (forzando)' : ''}`);
    await lote(db, fichas, 'lote');
  }
  if (flag('limpiar') || flag('todas')) await limpiar(db);
  if (resumen.size) console.log(`[${hora()}] RESUMEN: ${[...resumen].map(([k, v]) => `${k}=${v}`).join(', ')}`);
}

main().catch((e) => {
  console.error(`✖ ${e.message}`);
  process.exit(1);
});
