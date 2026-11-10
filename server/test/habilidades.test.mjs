/**
 * Habilidades: el catálogo de estados (colores, evoluciones, facciones) y el validador del kit.
 * Puro: sin base ni red.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ESTADOS,
  bloqueDeEvolucion,
  buscarEstado,
  tieneFaccion,
  estadosEntregados,
  htmlDeEfecto,
  textoPlanoDe,
  spanDeEstado,
  validarKit,
} from "../src/habilidades.mjs";

const s = (nombre) => spanDeEstado(nombre);

/** Un kit que cumple todo: el resto de pruebas lo estropea de a una regla. */
function kitValido() {
  return [
    {
      category: "active",
      effectHtml: `Ataque Mágico Base +45 y aplicas ${s("Miedo")} durante 2 turnos.<br>`,
    },
    {
      category: "active",
      effectHtml: `Ataque Base +40 y obtienes ${s("Fortissimo")} durante 2 turnos.<br>Si el enemigo posee ${s("Miedo")}, recuperas 5% de MP.`,
    },
    {
      category: "passive",
      effectHtml:
        "Al iniciar tu turno con menos del 50% de HP, recuperas 10 MP.<br>",
    },
    {
      category: "passive",
      effectHtml: `La primera vez que recibes un golpe crítico, obtienes ${s("Clarividencia")} durante 2 turnos.<br>`,
    },
    {
      category: "ultimate",
      effectHtml:
        "Realizas 4 ataques consecutivos equivalentes a Ataque Base +40.<br>\n" +
        `<br>Aplicas ${s("Hemorragia")} y obtienes ${s("Renacimiento")} durante 2 turnos.<br>\n` +
        `${bloqueDeEvolucion("Sangrado")}\n${bloqueDeEvolucion("Revitalia")}`,
    },
  ];
}

const codigos = (problemas) => problemas.map((p) => p.codigo);

test("el catálogo tiene los 42 estados del sistema, cada uno con su evolución y nombres únicos", () => {
  assert.equal(ESTADOS.length, 42);
  const nombres = ESTADOS.flatMap((e) => [e.nombre, e.evolucion.nombre]);
  assert.equal(new Set(nombres).size, nombres.length);
  for (const e of ESTADOS) {
    assert.ok(e.color || e.estilo, `${e.nombre} sin color`);
    assert.ok(
      e.evolucion.efecto.length >= 2,
      `${e.nombre}: efecto oficial incompleto`,
    );
    assert.ok(["positivo", "negativo", "ambos"].includes(e.polaridad));
  }
});

test("buscarEstado acepta tildes, mayúsculas y los alias de la tabla de evoluciones", () => {
  assert.equal(buscarEstado("confusion").canonico, "Confusión");
  assert.equal(buscarEstado("Deus ex Machina").canonico, "Deux ex Machina");
  assert.equal(buscarEstado("Mente Ágil").canonico, "Mente Agil");
  assert.equal(buscarEstado("Glotonería").canonico, "Glotoneria");
  assert.equal(buscarEstado("Incineración").esEvolucion, true);
  assert.equal(buscarEstado("Rojo"), null);
});

test("la evolución se pinta con el color de su base y Hackeo con su degradado", () => {
  assert.equal(
    s("Incineración"),
    '<span style="color:#c35a05; font-weight:bold;">Incineración</span>',
  );
  assert.match(
    s("System Override"),
    /linear-gradient\(#fff 0%,#fff 45%,#aaa 85%,#555 100%\)/,
  );
});

test("bloqueDeEvolucion recibe la base y escribe la evolución con sus líneas oficiales", () => {
  const bloque = bloqueDeEvolucion("Congelado");
  assert.match(
    bloque,
    /^<br>Mientras <span[^>]*>Crioestasis<\/span> esté activo:<br>/,
  );
  assert.match(bloque, /Reduce Velocidad en 30\.<br>/);
});

test("estadosEntregados cuenta lo que sigue al verbo, no lo que se nombra en una condición", () => {
  const html = `Aplicas ${s("Miedo")} y obtienes ${s("LionHeart")}.<br>Si el enemigo posee ${s("Sangrado")}, +10 daño.`;
  assert.deepEqual(estadosEntregados(html), [
    { verbo: "aplicas", texto: "Miedo" },
    { verbo: "obtienes", texto: "LionHeart" },
  ]);
  assert.deepEqual(
    estadosEntregados(
      `obtienes ${s("Fortissimo")} y ${s("Inspiratio")} durante 2 turnos`,
    ).map((e) => e.texto),
    ["Fortissimo", "Inspiratio"],
  );
});

test("un kit correcto no tiene problemas", () => {
  assert.deepEqual(
    validarKit({
      habilidades: kitValido(),
      facciones: ["resonantia", "abyssal"],
    }),
    [],
  );
});

test("obtener un negativo o aplicar un positivo es error; los ambivalentes admiten los dos", () => {
  const kit = kitValido();
  kit[0].effectHtml = `Ataque Base +45 y obtienes ${s("Miedo")} durante 2 turnos.`;
  kit[1].effectHtml = `Ataque Base +40 y aplicas ${s("Fortissimo")} durante 2 turnos.`;
  kit[2].effectHtml = `Aplicas ${s("Hackeo")} durante 1 turno.`;
  const problemas = validarKit({ habilidades: kit, facciones: null });
  assert.deepEqual(
    problemas.filter((p) => p.codigo === "verbo_invertido").map((p) => p.pieza),
    ["Activa 1", "Activa 2"],
  );
});

test("una activa entrega como máximo un estado", () => {
  const kit = kitValido();
  kit[0].effectHtml = `Ataque Base +45 y aplicas ${s("Miedo")} y ${s("Sangrado")} durante 2 turnos.`;
  assert.ok(
    codigos(validarKit({ habilidades: kit })).includes("activa_varios_estados"),
  );
});

test("la Ultimate usa la evolución y exactamente dos estados", () => {
  const kit = kitValido();
  kit[4].effectHtml = `Ataque Base +80.<br>Aplicas ${s("Sangrado")} durante 2 turnos.`;
  const c = codigos(validarKit({ habilidades: kit }));
  assert.ok(c.includes("ultimate_estado_base"));
  assert.ok(c.includes("ultimate_estados"));
});

test("la Habilidad Única de la Ultimate no cuenta como estado ni se acusa de desconocida", () => {
  const kit = kitValido();
  kit[4].effectHtml +=
    '<br>Se activa la habilidad única <span style="color:#56bd45; font-weight:bold;">Tidal Oath</span> durante 2 turnos.<br>';
  assert.deepEqual(validarKit({ habilidades: kit }), []);
});

test("evolución sin sus efectos oficiales es un aviso; «tus»/«obtienes» se toleran", () => {
  const kit = kitValido();
  kit[4].effectHtml = kit[4].effectHtml.replace(
    "No puede recuperar HP durante la duración del efecto.",
    "Pierde HP.",
  );
  const p = validarKit({ habilidades: kit }).find(
    (x) => x.codigo === "efecto_no_oficial",
  );
  assert.equal(p.gravedad, "aviso");
  assert.equal(p.estado, "Hemorragia");

  const tolerado = kitValido();
  tolerado[4].effectHtml = tolerado[4].effectHtml.replace(
    "Obtiene +20 Ataque Base.",
    "Obtienes +20 Ataque Base.",
  );
  assert.deepEqual(validarKit({ habilidades: tolerado }), []);
});

test("un color que no es el oficial es error (Hackeo en blanco liso también)", () => {
  const kit = kitValido();
  kit[0].effectHtml =
    'Ataque Base +45 y aplicas <span style="color:#8b5cf6; font-weight:bold;">Confusión</span> durante 2 turnos.';
  kit[2].effectHtml =
    'Aplicas <span style="color:#ffffff; font-weight:bold;">Hackeo</span> durante 1 turno.';
  const errores = validarKit({ habilidades: kit }).filter(
    (p) => p.codigo === "color_incorrecto",
  );
  assert.deepEqual(
    errores.map((p) => p.estado),
    ["Confusión", "Hackeo"],
  );
});

test("los estados exclusivos exigen su facción, también en su forma evolucionada", () => {
  const kit = kitValido();
  kit[1].effectHtml = `Ataque Base +40 y obtienes ${s("Juramento")} durante 2 turnos.`;
  kit[4].effectHtml = kit[4].effectHtml.replace(/Renacimiento/g, "Dies Irae");
  const exclusivos = (facciones) =>
    validarKit({ habilidades: kit, facciones })
      .filter((p) => p.codigo === "faccion_exclusiva")
      .map((p) => p.estado);
  assert.deepEqual(exclusivos(["resonantia"]), ["Juramento", "Dies Irae"]);
  assert.deepEqual(exclusivos(["heaven-s-arbiter", "necrotic"]), []);
  assert.deepEqual(exclusivos(null), [], "sin facciones conocidas no se acusa");
});

test("la subfacción acredita a su madre solo con la relación en los datos", () => {
  const mapa = { "glovecaller-elfs": "glovecaller" };
  // Con la relación guardada, la hija desbloquea lo exclusivo de la madre.
  assert.equal(tieneFaccion(["glovecaller-elfs"], "glovecaller", mapa), true);
  // La madre sigue sin acreditar lo de la hija (la herencia va hacia arriba).
  assert.equal(tieneFaccion(["glovecaller"], "glovecaller-elfs", mapa), false);
  // Sin la relación no se adivina: el slug se llama igual pero NO cuenta.
  assert.equal(tieneFaccion(["glovecaller-elfs"], "glovecaller"), false);
  // La etiqueta con paréntesis también funciona: se compara canónica.
  assert.equal(
    tieneFaccion(["Glovecaller (Elfs)"], "glovecaller", mapa),
    true,
  );
});

test("la herencia sube varios niveles y un ciclo en los datos no la cuelga", () => {
  const cadena = {
    "glovecaller-elfs": "glovecaller",
    "glovecaller-elite": "glovecaller-elfs",
  };
  assert.equal(tieneFaccion(["glovecaller-elite"], "glovecaller", cadena), true);
  const ciclo = { a: "b", b: "a" };
  assert.equal(tieneFaccion(["a"], "c", ciclo), false);
});

test("el kit de una subfacción pasa la exclusividad de su madre", () => {
  const kit = kitValido();
  kit[1].effectHtml = `Ataque Base +40 y obtienes ${s("Fortificación")} durante 2 turnos.`;
  const mapa = { "glovecaller-elfs": "glovecaller" };
  const exclusivos = (facciones, subfacciones) =>
    validarKit({ habilidades: kit, facciones, subfacciones })
      .filter((p) => p.codigo === "faccion_exclusiva")
      .map((p) => p.estado);
  assert.deepEqual(exclusivos(["glovecaller"], mapa), [], "la madre puede");
  assert.deepEqual(
    exclusivos(["glovecaller-elfs"], mapa),
    [],
    "la hija puede por su madre",
  );
  assert.deepEqual(
    exclusivos(["glovecaller-elfs"]),
    ["Fortificación"],
    "sin el mapa se sigue acusando",
  );
  assert.deepEqual(exclusivos(["abyssal"], mapa), ["Fortificación"]);
});

test("repetir un estado entre piezas es aviso, y la evolución cuenta como su base", () => {
  const kit = kitValido();
  kit[0].effectHtml = `Ataque Base +45 y aplicas ${s("Sangrado")} durante 2 turnos.`;
  const p = validarKit({ habilidades: kit }).find(
    (x) => x.codigo === "estado_repetido",
  );
  assert.equal(p.gravedad, "aviso");
  assert.equal(p.pieza, "Activa 1, Ultimate");
});

test("la forma del kit: 2 activas, 2 pasivas y 1 Ultimate", () => {
  const kit = kitValido().filter((h) => h.category !== "passive");
  assert.ok(
    codigos(validarKit({ habilidades: kit })).includes("forma_del_kit"),
  );
});

test("htmlDeEfecto: el efecto en texto plano se escapa antes de inyectarse", () => {
  assert.equal(
    htmlDeEfecto({ effect: "<img src=x onerror=alert(1)>\nfin" }),
    "&lt;img src=x onerror=alert(1)&gt;<br>fin",
  );
  assert.equal(
    htmlDeEfecto({ effect: "a", effectHtml: `Aplica ${s("Sangrado")}` }),
    `Aplica ${s("Sangrado")}`,
  );
  assert.equal(htmlDeEfecto(undefined), "");
});

test("textoPlanoDe no deja etiquetas reconstruidas al quitar las de dentro", () => {
  assert.equal(
    textoPlanoDe("<<b>script>alert(1)<</b>/script>"),
    "scriptalert(1)/script",
  );
  assert.equal(
    textoPlanoDe("Ataque &lt;base&gt;<br>+10"),
    "Ataque <base>\n+10",
  );
});

test("tieneFaccion: acepta slug, etiqueta y variantes con errata de la misma facción", () => {
  assert.equal(tieneFaccion(["mythical-legacy"], "mythical-legacy"), true);
  assert.equal(tieneFaccion(["Mythical Legacy"], "mythical-legacy"), true);
  assert.equal(tieneFaccion(["mythical-legacy3"], "mythical-legacy"), true);
  assert.equal(tieneFaccion(["Mythical Lecagy"], "mythical-legacy"), true);
  assert.equal(tieneFaccion(["netherbane"], "mythical-legacy"), false);
  assert.equal(tieneFaccion([], "mythical-legacy"), false);
  // Una SUBCACCIÓN no acredita nada sin su relación guardada: el nombre no la delata. Antes se
  // adivinaba por el paréntesis y por el sufijo del slug, y eso daba por bueno cualquier parecido.
  assert.equal(
    tieneFaccion(["Mythical Legacy (Kitsune)"], "mythical-legacy"),
    false,
  );
  assert.equal(tieneFaccion(["glovecaller-elfs"], "glovecaller"), false);
  assert.equal(
    tieneFaccion(["mythical-legacy-kitsune"], "mythical-legacy"),
    false,
  );
  assert.equal(tieneFaccion(["netherbane-oni"], "mythical-legacy"), false);
  assert.equal(tieneFaccion([], ""), false);
  assert.equal(
    tieneFaccion(["Netherbane (Alfa)"], "mythical-legacy"),
    false,
  );
});

test("una ficha de una subfacción puede usar los estados exclusivos de su facción madre", () => {
  const kit = kitValido();
  kit[1].effectHtml = `Ataque Base +40 y obtienes ${s("Juramento")} durante 2 turnos.`;
  const mapa = { "heaven-s-arbiter-alfa": "heaven-s-arbiter" };
  const exclusivos = (facciones, subfacciones) =>
    validarKit({ habilidades: kit, facciones, subfacciones })
      .filter((p) => p.codigo === "faccion_exclusiva")
      .map((p) => p.estado);
  assert.deepEqual(exclusivos(["heaven-s-arbiter"], mapa), []);
  assert.deepEqual(exclusivos(["heaven-s-arbiter-alfa"], mapa), []);
  // Sin la relación guardada, la subfacción no acredita lo de su madre.
  assert.deepEqual(exclusivos(["heaven-s-arbiter-alfa"]), ["Juramento"]);
  assert.deepEqual(exclusivos(["abyssal"], mapa), ["Juramento"]);

  // El caso que se reportó: la ficha de una subfacción guardada como slug (`glovecaller-elfs`)
  // no podía obtener Fortificación, que es exclusiva de la madre.
  const fortificacion = kitValido();
  fortificacion[1].effectHtml = `Ataque Base +40 y obtienes ${s("Fortificación")} durante 2 turnos.`;
  const mapaGlovecaller = { "glovecaller-elfs": "glovecaller" };
  const fortificacionBloqueada = (facciones, subfacciones) =>
    validarKit({ habilidades: fortificacion, facciones, subfacciones })
      .filter((p) => p.codigo === "faccion_exclusiva")
      .map((p) => p.estado);
  assert.deepEqual(
    fortificacionBloqueada(["glovecaller"], mapaGlovecaller),
    [],
  );
  assert.deepEqual(
    fortificacionBloqueada(["glovecaller-elfs"], mapaGlovecaller),
    [],
  );
  assert.deepEqual(
    fortificacionBloqueada(["Glovecaller (Elfs)"], mapaGlovecaller),
    [],
  );
  // Sin la relación en los datos se sigue acusando, y otra facción no se cuela.
  assert.deepEqual(
    fortificacionBloqueada(["glovecaller-elfs"]),
    ["Fortificación"],
  );
  assert.deepEqual(fortificacionBloqueada(["abyssal"], mapaGlovecaller), [
    "Fortificación",
  ]);
});
