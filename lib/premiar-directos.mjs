/**
 * PREMIA con experiencia a las fichas que están transmitiendo (Twitch o Kick), a partir de las redes de cada una.
 *
 * Quién llama: `scripts/premiar-directos.mjs` (en bucle, cada pocos minutos). NO lo dispara una visita a la ficha: la XP no
 * puede depender de que alguien mire, ni un visitante poder provocar pagos.
 *
 * Por qué solo Twitch y Kick: revisar un directo de YouTube cuesta 3 unidades de cuota (`lib/directos.mjs`) y con ~800 fichas cada
 * pasada gastaría las 10.000 diarias en horas. YouTube se muestra en la ficha (una consulta por visita, cacheada) pero no paga.
 * `plataformas` lo cambia si algún día hay más cuota.
 *
 * Una ficha con varios canales en directo cobra UNA vez por tramo (el id del tramo no incluye la plataforma). Las reglas
 * (5 XP por tramo de 30 min, 50 al día, idempotente) viven en `premiarDirecto` (`server/src/minecraft.mjs`).
 */
import { canalesDeRedes, estadoDeCanal, precalentarTwitch } from "./directos.mjs";
import { premiarDirecto } from "../server/src/minecraft.mjs";

export const PLATAFORMAS_QUE_PAGAN = ["twitch", "kick"];
const CONCURRENCIA = 5;

/**
 * @param {Array<{ id: number, slug?: string, socials?: Array<{ url: string }> }>} fichas
 * @param {{ ejecutor: object, dia: string, plataformas?: string[], opciones?: object, ahora?: number }} contexto
 * @returns {Promise<{ revisadas: number, enDirecto: number, pagadas: number, xp: number, errores: number }>}
 */
export async function premiarDirectos(
  fichas,
  { ejecutor, dia, plataformas = PLATAFORMAS_QUE_PAGAN, opciones = {}, ahora = Date.now() },
) {
  const resumen = { revisadas: 0, enDirecto: 0, pagadas: 0, xp: 0, errores: 0 };
  const pendientes = fichas
    .map((f) => ({ ficha: f, canales: canalesDeRedes(f.socials).filter((c) => plataformas.includes(c.plataforma)) }))
    .filter((p) => p.canales.length);

  // Twitch en lotes de 100 logins: llena la caché y la revisión de abajo ya no pregunta canal por canal.
  if (plataformas.includes("twitch"))
    await precalentarTwitch(pendientes.flatMap((p) => p.canales), opciones);

  async function revisar({ ficha, canales }) {
    resumen.revisadas += 1;
    // Se consulta de a un canal y se corta en el primero en vivo: pagar es por ficha, no por canal.
    for (const canal of canales) {
      const estado = await estadoDeCanal(canal, opciones);
      if (estado.estado === "error") resumen.errores += 1;
      if (estado.estado !== "ok" || !estado.enVivo) continue;
      resumen.enDirecto += 1;
      try {
        const xp = await premiarDirecto(ejecutor, { vtuberId: ficha.id, plataforma: canal.plataforma, dia, ahora });
        if (xp > 0) {
          resumen.pagadas += 1;
          resumen.xp += xp;
        }
      } catch (error) {
        resumen.errores += 1;
        console.error(`[premiar-directos] ficha ${ficha.id}: ${error.message}`);
      }
      return;
    }
  }

  // Pocas a la vez: son ~800 fichas y las plataformas limitan por minuto.
  const cola = [...pendientes];
  await Promise.all(
    Array.from({ length: CONCURRENCIA }, async () => {
      for (let p = cola.shift(); p; p = cola.shift()) await revisar(p);
    }),
  );
  return resumen;
}
