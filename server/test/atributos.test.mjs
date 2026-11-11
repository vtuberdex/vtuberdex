/** Atributos RPG de la ficha: reparto de 200 puntos, bonos de facción y stats derivados. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import {
  ATRIBUTO_MAXIMO,
  PUNTOS_DE_ATRIBUTOS,
  AtributoError,
  aplicarAtributosAStats,
  atributosFinales,
  bonosDeFacciones,
  estadoDeAtributos,
  guardarAtributos,
  statsDeAtributosDe,
  statsDerivados,
} from "../src/atributos.mjs";
import { ejecutorSqlite } from "../src/solicitudes.mjs";

const nuevo = () => ejecutorSqlite(new DatabaseSync(":memory:"));
const fallo = (p) =>
  p.then(
    () => null,
    (e) => e,
  );
const FICHA_VACIA = { vtuberId: 7, facciones: [], stats: [] };
const FICHA_CON_STATS = {
  vtuberId: 8,
  facciones: [],
  stats: [{ slug: "hp", label: "HP", value: 12440 }],
};

test("el bono de las dos facciones se suma y las etiquetas se comparan canónicas", () => {
  const bonos = bonosDeFacciones(["Netherbane", "Heaven's Arbiter"]);
  assert.equal(bonos.cha, 45);
  assert.equal(bonos.str, 15);
  assert.equal(bonos.wis, 10);
  assert.equal(bonos.int, 0);
  // Erratas del scrape y subfacciones con el nombre de la madre cuentan igual.
  assert.equal(bonosDeFacciones(["netherbane2"]).cha, 20);
  assert.equal(bonosDeFacciones(["Mythical Lecagy"]).str, 25);
  assert.deepEqual(bonosDeFacciones([]), {
    str: 0,
    dex: 0,
    con: 0,
    int: 0,
    wis: 0,
    cha: 0,
  });
});

test("ningún atributo final pasa de 100 aunque el bono lo empuje", () => {
  const finales = atributosFinales({ cha: 95 }, { cha: 20 });
  assert.equal(finales.find((a) => a.slug === "cha").valor, ATRIBUTO_MAXIMO);
  const conSobra = atributosFinales({ str: 60 }, { str: 45 });
  assert.equal(conSobra.find((a) => a.slug === "str").valor, 100);
});

test("cada atributo parte de 40 de base y los puntos se suman encima", () => {
  const finales = atributosFinales({ str: 10 }, {});
  const str = finales.find((a) => a.slug === "str");
  assert.equal(str.base, 40);
  assert.equal(str.valor, 50); // 40 + 10
  assert.equal(str.maximoAsignable, 60); // hasta 100
  // Con un bono de +20 solo caben 40 puntos más.
  const conBono = atributosFinales({}, { cha: 20 }).find((a) => a.slug === "cha");
  assert.equal(conBono.valor, 60); // 40 + 20
  assert.equal(conBono.maximoAsignable, 40);
});

test("los stats derivados salen de los atributos finales y se redondean", () => {
  const finales = atributosFinales(
    { con: 40, int: 30, str: 51, wis: 20, dex: 25, cha: 15 },
    {},
  );
  const valor = (slug) =>
    statsDerivados(finales).find((d) => d.slug === slug).value;
  // Con los 40 de base: CON 80, INT 70, STR 91, WIS 60, DEX 65 y CHA 55.
  assert.equal(valor("hp"), 1200); // 80 × 15
  assert.equal(valor("mp"), 700); // 70 × 10
  assert.equal(valor("attack"), 200); // 91 × 2,2 = 200,2
  assert.equal(valor("defense"), 120); // 80 × 1,5
  assert.equal(valor("magicAttack"), 154); // 70 × 2,2
  assert.equal(valor("magicDefense"), 108); // 60 × 1,8
  assert.equal(valor("speed"), 98); // 65 × 1,5 = 97,5 → 98
  assert.equal(valor("evasion"), 52); // 65 × 0,8
  assert.equal(valor("accuracy"), 78); // 65 × 1,2
  assert.equal(valor("critic"), 28); // 55 × 0,5 = 27,5 → 28
  assert.equal(valor("luck"), 6); // (60 + 55) / 2 / 10 = 5,75 → 6
});

test("una ficha nueva reparte sus 200 puntos y los recupera al volver", async () => {
  const e = nuevo();
  const antes = await estadoDeAtributos(e, FICHA_VACIA);
  assert.equal(antes.estado, "vacio");
  assert.equal(antes.puedeEditar, true);
  assert.equal(antes.disponibles, PUNTOS_DE_ATRIBUTOS);

  const despues = await guardarAtributos(e, {
    ...FICHA_VACIA,
    puntos: { str: 60, dex: 40, con: 50, int: 30, wis: 10, cha: 10 },
  });
  assert.equal(despues.estado, "repartido");
  assert.equal(despues.repartidos, 200);
  assert.equal(despues.disponibles, 0);
  assert.equal(despues.puedeEditar, false);
  assert.equal(despues.finales.find((a) => a.slug === "str").puntos, 60);
  assert.equal(despues.derivados.find((d) => d.slug === "hp").value, 1350);

  // Al volver a abrir la ficha, lo guardado sigue ahí.
  const releido = await estadoDeAtributos(e, FICHA_VACIA);
  assert.equal(releido.repartidos, 200);
  assert.equal(releido.finales.find((a) => a.slug === "int").puntos, 30);
});

test("los bonos de facción no gastan puntos y entran en los derivados", async () => {
  const e = nuevo();
  const estado = await guardarAtributos(e, {
    ...FICHA_VACIA,
    facciones: ["Netherbane"],
    puntos: { str: 40, cha: 40 },
  });
  assert.equal(estado.repartidos, 80);
  assert.equal(estado.disponibles, 120);
  const cha = estado.finales.find((a) => a.slug === "cha");
  assert.equal(cha.bono, 20);
  assert.equal(cha.valor, 100); // 40 de base + 40 repartidos + 20 de bono (ya en el tope)
  assert.equal(cha.maximoAsignable, 40); // con el bono solo caben 40 puntos más
  assert.equal(estado.derivados.find((d) => d.slug === "attack").value, 209); // 95 × 2,2
  assert.equal(estado.derivados.find((d) => d.slug === "critic").value, 50); // 100 × 0,5
});

test("una ficha que ya tiene stats del scrape no reparte atributos", async () => {
  const e = nuevo();
  const estado = await estadoDeAtributos(e, FICHA_CON_STATS);
  assert.equal(estado.estado, "origen");
  assert.equal(estado.puedeEditar, false);
  const error = await fallo(
    guardarAtributos(e, { ...FICHA_CON_STATS, puntos: { str: 10 } }),
  );
  assert.ok(error instanceof AtributoError);
  assert.equal(error.status, 409);
  assert.equal(error.code, "atributos_bloqueados");
});

test("los stats ya creados no se reescriben ni con el mantenedor", async () => {
  const e = nuevo();
  const estado = await estadoDeAtributos(e, { ...FICHA_CON_STATS, admin: true });
  assert.equal(estado.puedeEditar, false);
  const error = await fallo(
    guardarAtributos(e, {
      ...FICHA_CON_STATS,
      puntos: { str: 10 },
      admin: true,
    }),
  );
  assert.equal(error?.code, "atributos_bloqueados");
  // Y aunque hubiera puntos guardados de antes, la ficha no recibe derivados: sus stats mandan.
  assert.deepEqual(await statsDeAtributosDe(e, FICHA_CON_STATS), []);
  assert.ok((await statsDeAtributosDe(e, FICHA_VACIA)).length === 0);
});

test("el mantenedor puede retocar una build ya repartida", async () => {
  const e = nuevo();
  await guardarAtributos(e, { ...FICHA_VACIA, puntos: { str: 200 - 100 } });
  const error = await fallo(
    guardarAtributos(e, { ...FICHA_VACIA, puntos: { str: 10 } }),
  );
  assert.equal(error.code, "atributos_bloqueados");
  const admin = await guardarAtributos(e, {
    ...FICHA_VACIA,
    puntos: { str: 10, con: 20 },
    admin: true,
  });
  assert.equal(admin.repartidos, 30);
  assert.equal(admin.finales.find((a) => a.slug === "str").puntos, 10);
});

test("no se puede pasar de 200 puntos ni de 100 en un atributo", async () => {
  const e = nuevo();
  const deMas = await fallo(
    guardarAtributos(e, {
      ...FICHA_VACIA,
      puntos: { str: 100, dex: 100, con: 1 },
    }),
  );
  assert.equal(deMas.code, "atributos_de_mas");
  const atributo = await fallo(
    guardarAtributos(e, { ...FICHA_VACIA, puntos: { str: 101 } }),
  );
  assert.equal(atributo.code, "atributo_invalido");
  const negativo = await fallo(
    guardarAtributos(e, { ...FICHA_VACIA, puntos: { str: -1 } }),
  );
  assert.equal(negativo.code, "atributo_invalido");
  const raro = await fallo(
    guardarAtributos(e, { ...FICHA_VACIA, puntos: { suerte: 5 } }),
  );
  assert.equal(raro.code, "atributo_desconocido");
  const vacio = await fallo(guardarAtributos(e, { ...FICHA_VACIA, puntos: [] }));
  assert.equal(vacio.code, "payload_invalido");
});

test("los derivados reemplazan el valor de los stats que ya existen", () => {
  const stats = [
    { slug: "hp", label: "HP", value: 1000, max: 1000 },
    { slug: "level", label: "Nivel", value: 5, max: null },
  ];
  const salida = aplicarAtributosAStats(stats, [
    { slug: "hp", label: "HP", value: 600 },
    { slug: "mp", label: "MP", value: 300 },
  ]);
  assert.deepEqual(
    salida.find((s) => s.slug === "hp"),
    { slug: "hp", label: "HP", value: 600, max: 1000 },
  );
  assert.deepEqual(salida.find((s) => s.slug === "level"), stats[1]);
  assert.deepEqual(salida.find((s) => s.slug === "mp"), {
    slug: "mp",
    label: "MP",
    value: 300,
  });
});
