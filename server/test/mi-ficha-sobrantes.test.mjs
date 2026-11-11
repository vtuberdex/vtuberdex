/** Pasar a stats los puntos de habilidad que ya no caben en ninguna habilidad, sobre SQLite en memoria. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import {
  PUNTOS_POR_NIVEL,
  PUNTOS_STATS_POR_NIVEL,
  RANGO_MAXIMO,
} from "../src/experiencia.mjs";
import {
  PuntosError,
  claveDeHabilidad,
  convertirPuntosSobrantes,
  estadoDePuntos,
  estadoDeStats,
  reiniciarRangos,
  subirHabilidad,
  subirStat,
} from "../src/mi-ficha.mjs";
import { ejecutorSqlite } from "../src/solicitudes.mjs";

const SKILLS = [{ category: "active", name: "Rayo Láser" }];
const STATS = [
  { slug: "hp", label: "HP", value: 1000 },
  { slug: "attack", label: "Ataque", value: 100 },
];
const nuevo = () => ejecutorSqlite(new DatabaseSync(":memory:"));
const entrada = (nivelesGanados) => ({ vtuberId: 7, skills: SKILLS, nivelesGanados });
const enStats = (nivelesGanados) => ({
  vtuberId: 7,
  stats: STATS,
  nivelesGanados,
});
const mensajeDe = async (promesa) =>
  promesa.then(
    () => null,
    (e) => e,
  );

/** Sube la única habilidad hasta su rango máximo gastando los puntos que haya. */
async function maxear(e, nivelesGanados) {
  const clave = claveDeHabilidad(SKILLS[0]);
  for (let i = 0; i < RANGO_MAXIMO; i += 1)
    await subirHabilidad(e, { ...entrada(nivelesGanados), clave });
}

test("mientras quepan puntos en una habilidad NO hay sobrantes ni se pueden convertir", async () => {
  const e = nuevo();
  // 1 nivel = 3 puntos y la única habilidad admite 5 rangos: todos caben, ninguno sobra.
  const antes = await estadoDePuntos(e, entrada(1));
  assert.equal(antes.ganados, PUNTOS_POR_NIVEL);
  assert.equal(antes.hueco, RANGO_MAXIMO);
  assert.equal(antes.sobrantes, 0);
  const error = await mensajeDe(
    convertirPuntosSobrantes(e, entrada(1)),
  );
  assert.ok(error instanceof PuntosError);
  assert.equal(error.code, "sin_sobrantes");
  // Nada se convirtió: la bolsa de stats sigue con lo suyo.
  const stats = await estadoDeStats(e, enStats(1));
  assert.equal(stats.convertidos, 0);
});

test("con las habilidades al máximo, lo que sobra se pasa a la bolsa de stats", async () => {
  const e = nuevo();
  const niveles = 4;
  await maxear(e, niveles);
  const antes = await estadoDePuntos(e, entrada(niveles));
  const ganados = niveles * PUNTOS_POR_NIVEL;
  assert.equal(antes.hueco, 0);
  assert.equal(antes.repartidos, RANGO_MAXIMO);
  assert.equal(antes.sobrantes, ganados - RANGO_MAXIMO);
  assert.ok(antes.sobrantes > 0);

  const despues = await convertirPuntosSobrantes(e, entrada(niveles));
  assert.equal(despues.convertidos, antes.sobrantes);
  assert.equal(despues.disponibles, 0);
  assert.equal(despues.sobrantes, 0);
  assert.equal(despues.gastables, ganados - antes.sobrantes);
  // Los rangos no se tocan al convertir: siguen donde estaban.
  assert.equal(despues.habilidades[0].rango, RANGO_MAXIMO);

  const stats = await estadoDeStats(e, enStats(niveles));
  assert.equal(stats.convertidos, antes.sobrantes);
  assert.equal(stats.disponibles, niveles * PUNTOS_STATS_POR_NIVEL + antes.sobrantes);
});

test("no se convierte dos veces lo mismo", async () => {
  const e = nuevo();
  const niveles = 4;
  await maxear(e, niveles);
  const primera = await convertirPuntosSobrantes(e, entrada(niveles));
  const error = await mensajeDe(convertirPuntosSobrantes(e, entrada(niveles)));
  assert.ok(error instanceof PuntosError);
  assert.equal(error.code, "sin_sobrantes");
  const ahora = await estadoDePuntos(e, entrada(niveles));
  assert.equal(ahora.convertidos, primera.convertidos);
});

test("lo convertido no vuelve ni al reiniciar los rangos", async () => {
  const e = nuevo();
  const niveles = 4;
  await maxear(e, niveles);
  const convertido = await convertirPuntosSobrantes(e, entrada(niveles));
  const trasReiniciar = await reiniciarRangos(e, entrada(niveles));
  assert.equal(trasReiniciar.repartidos, 0);
  assert.equal(trasReiniciar.convertidos, convertido.convertidos);
  assert.equal(trasReiniciar.disponibles, convertido.disponibles);
  assert.equal(trasReiniciar.gastables, convertido.gastables);
});

test("el punto convertido se puede gastar en un stat y sube su valor", async () => {
  const e = nuevo();
  const niveles = 4;
  await maxear(e, niveles);
  await convertirPuntosSobrantes(e, entrada(niveles));
  const antes = await estadoDeStats(e, enStats(niveles));
  const despues = await subirStat(e, { ...enStats(niveles), slug: "hp" });
  assert.equal(despues.disponibles, antes.disponibles - 1);
  const hp = despues.stats.find((s) => s.slug === "hp");
  assert.equal(hp.puntos, 1);
  assert.equal(hp.valor, 1000 + hp.paso);
});
