#!/usr/bin/env node
/**
 * Premia con XP a las fichas que están en directo (Twitch / Kick). Ver `lib/premiar-directos.mjs`.
 *
 *   node scripts/premiar-directos.mjs            una pasada y sale
 *   node scripts/premiar-directos.mjs --vigilar  servicio: una pasada cada VTUBERDEX_DIRECTOS_CADA_MIN (10) minutos
 *   node scripts/premiar-directos.mjs --seco     informa quién está en directo, sin pagar nada
 *
 * Entorno: TWITCH_CLIENT_ID/SECRET y KICK_CLIENT_ID/SECRET (sin ellas la plataforma se salta), TURSO_DATABASE_URL (o la
 * base local de `lib/solicitudes.mjs`, donde vive la XP), VTUBERDEX_DB como el resto de scripts.
 */
import { dbConDiario } from "../lib/diario.mjs";
import { diaDeChile } from "../lib/likes.mjs";
import { PLATAFORMAS_QUE_PAGAN, premiarDirectos } from "../lib/premiar-directos.mjs";
import { ejecutorDeSolicitudes } from "../lib/solicitudes.mjs";
import { getVtuberBySlug, searchVtubers } from "../server/src/search.mjs";

const vigilar = process.argv.includes("--vigilar");
const seco = process.argv.includes("--seco");
const CADA_MS = Math.max(1, Number(process.env.VTUBERDEX_DIRECTOS_CADA_MIN) || 10) * 60_000;

function fichasPublicadas(db) {
  const todas = [];
  for (let pagina = 1; ; pagina += 1) {
    const r = searchVtubers(db, { sort: "dex", page: pagina, perPage: 100 });
    todas.push(...r.items);
    if (pagina >= r.pageCount) break;
  }
  return todas;
}

async function pasada() {
  const db = await dbConDiario();
  // El listado no trae las redes: salen del detalle de cada ficha (SQLite síncrono, milisegundos para todas).
  const fichas = fichasPublicadas(db).map((f) => ({ id: f.id, slug: f.slug, socials: getVtuberBySlug(db, f.slug)?.socials ?? [] }));
  if (!process.env.TWITCH_CLIENT_ID && !process.env.KICK_CLIENT_ID)
    console.warn("[premiar-directos] sin credenciales de Twitch ni Kick: no hay nada que revisar");
  const resumen = await premiarDirectos(fichas, {
    ejecutor: seco ? { execute: async () => ({ rows: [], rowsAffected: 0 }), exec: async () => {} } : await ejecutorDeSolicitudes(),
    dia: diaDeChile(),
    plataformas: PLATAFORMAS_QUE_PAGAN,
  });
  console.log(`[premiar-directos] ${new Date().toISOString()} ${seco ? "(seco) " : ""}${JSON.stringify(resumen)}`);
}

do {
  try {
    await pasada();
  } catch (error) {
    console.error(`[premiar-directos] la pasada falló: ${error.message}`);
    if (!vigilar) process.exitCode = 1;
  }
  if (vigilar) await new Promise((r) => setTimeout(r, CADA_MS));
} while (vigilar);
