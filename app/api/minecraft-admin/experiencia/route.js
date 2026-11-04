/**
 * `/api/minecraft-admin/experiencia` — dar (o quitar) experiencia a mano a cualquier ficha.
 *
 * `GET ?q=texto` busca fichas por nombre o `#dex`; `GET ?ficha=<id>` devuelve su nivel, su barra y los
 * últimos ajustes manuales; `POST { ficha, cantidad, motivo }` registra un ajuste. SOLO admin: regalar
 * experiencia cambia el nivel, los puntos de habilidad y el grado que puede reclamar una ficha, así que
 * no se le deja a cualquier mantenedor. Cada ajuste guarda quién lo hizo y por qué (`xp_manual`).
 */
import {
  ROL_ADMIN,
  conMantenedor,
  respuestaJson,
} from "../../../../lib/minecraft-admin.mjs";
import { dbConDiario } from "../../../../lib/diario.mjs";
import { conExperiencia, contarLikes } from "../../../../lib/likes.mjs";
import { ejecutorDeSolicitudes } from "../../../../lib/solicitudes.mjs";
import {
  getVtuberBySlug,
  searchVtubers,
} from "../../../../server/src/search.mjs";
import {
  XP_MANUAL_MAX,
  darXpManual,
  historialXpManual,
  xpDeJuego,
} from "../../../../server/src/minecraft.mjs";

export const dynamic = "force-dynamic";

const resumen = (card) => ({
  id: card.id,
  slug: card.slug,
  name: card.name,
  dex: card.dexNumber,
});

/** Nivel y barra tal como los ve la ficha pública: likes + XP de juego + ajustes manuales. */
async function vistaDeExperiencia(card, ejecutor) {
  const [likes, xp] = await Promise.all([
    contarLikes(card.id),
    xpDeJuego(ejecutor, card.id),
  ]);
  const conNivel = conExperiencia(card, likes, xp);
  return {
    ...resumen(card),
    level: conNivel.level,
    experience: conNivel.experience,
    xpDeJuego: xp,
    likes,
  };
}

export async function GET(request) {
  return conMantenedor(
    request,
    async () => {
      const url = new URL(request.url);
      const db = await dbConDiario();
      const ficha = url.searchParams.get("ficha");
      if (ficha !== null) {
        const id = Number(ficha);
        if (!Number.isInteger(id) || id <= 0)
          return respuestaJson({ error: "ficha_invalida" }, 400);
        const fila = db.prepare("SELECT slug FROM vtuber WHERE id = ?").get(id);
        if (!fila) return respuestaJson({ error: "no_encontrada" }, 404);
        // Por slug y con los ocultos: buscar por texto (FTS) fallaba con slugs con guiones y no
        // devolvía las fichas en borrador o dadas de baja, que también pueden recibir XP.
        const card = getVtuberBySlug(db, fila.slug, { includeHidden: true });
        if (!card) return respuestaJson({ error: "no_encontrada" }, 404);
        const e = await ejecutorDeSolicitudes();
        return respuestaJson({
          ficha: await vistaDeExperiencia(card, e),
          historial: await historialXpManual(e, id),
          maximo: XP_MANUAL_MAX,
        });
      }
      const q = (url.searchParams.get("q") ?? "").trim();
      if (q.length < 2) return respuestaJson({ fichas: [] });
      const { items } = searchVtubers(db, {
        includeHidden: true,
        q: q.replace(/^#/, ""),
        perPage: 8,
      });
      return respuestaJson({ fichas: items.map(resumen) });
    },
    { minimo: ROL_ADMIN },
  );
}

export async function POST(request) {
  return conMantenedor(
    request,
    async (acceso) => {
      const cuerpo = await request.json().catch(() => null);
      if (!cuerpo || typeof cuerpo !== "object")
        return respuestaJson({ error: "cuerpo_invalido" }, 400);
      const db = await dbConDiario();
      const id = Number(cuerpo.ficha);
      if (
        !Number.isInteger(id) ||
        !db.prepare("SELECT 1 FROM vtuber WHERE id = ?").get(id)
      )
        return respuestaJson({ error: "no_encontrada" }, 404);
      const e = await ejecutorDeSolicitudes();
      const r = await darXpManual(e, {
        vtuberId: id,
        cantidad: cuerpo.cantidad,
        motivo: cuerpo.motivo,
        actor: acceso.sesion.email,
      });
      if (!r.ok) return respuestaJson(r.cuerpo, r.status);
      return respuestaJson(
        { ok: true, cantidad: r.cantidad, xpDeJuego: r.xpTotal },
        201,
      );
    },
    { minimo: ROL_ADMIN },
  );
}
