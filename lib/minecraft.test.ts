/**
 * Minecraft: las rutas del plugin (token de servidor) y el código de «Mi ficha», de punta a punta sobre SQLite en
 * memoria. La ficha y los likes se simulan; lo que se prueba es el contrato HTTP y que la XP llega a la experiencia.
 */
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const FICHAS = vi.hoisted(() => ({
  luna: {
    id: 7,
    slug: "luna",
    name: "Luna",
    level: 1,
    experience: { current: 0, max: 100 },
    premium: null,
    skills: [],
    stats: [],
  },
}));

vi.mock("@/server/src/search.mjs", () => ({
  getVtuberBySlug: (_db: unknown, slug: string) =>
    (FICHAS as Record<string, unknown>)[slug] ?? null,
}));
vi.mock("@/lib/diario.mjs", () => ({ dbConDiario: async () => DB }));
vi.mock("@/lib/likes.mjs", async (original) => ({
  ...(await original<typeof import("@/lib/likes.mjs")>()),
  contarLikes: async () => 0,
}));

import * as correo from "@/lib/correo.mjs";
import * as mc from "@/lib/minecraft.mjs";
import * as miFicha from "@/lib/mi-ficha.mjs";
import { XP_JUEGO_MAX_DIA } from "@/server/src/experiencia.mjs";
import { conTablas, ejecutorSqlite } from "@/server/src/solicitudes.mjs";
import { crearToken } from "@/server/src/verificacion.mjs";

/** La base de fichas solo se usa para traducir id → slug/nombre. */
const DB = {
  prepare: () => ({
    get: (id: number) =>
      id === 7 ? { slug: "luna", name: "Luna" } : undefined,
  }),
};
const TOKEN = "token-del-servidor-de-minecraft";
const ENV = { VTUBERDEX_MINECRAFT_TOKEN: TOKEN };
const JUGADOR = "069a79f4-44e9-4726-a5be-fca90e38aaf5";

let e: ReturnType<typeof ejecutorSqlite>;

const pedir = (
  url: string,
  {
    cuerpo,
    token = TOKEN,
    metodo = "POST",
  }: { cuerpo?: unknown; token?: string | null; metodo?: string } = {},
) =>
  new Request(`http://localhost${url}`, {
    method: metodo,
    headers: {
      "content-type": "application/json",
      host: "localhost",
      ...(token ? { "x-minecraft-token": token } : {}),
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });

async function enlaceDeMiFicha() {
  return crearToken(e, { proposito: "ficha", email: "luna@example.com" });
}

async function codigoDeMiFicha(token: string) {
  const r = await miFicha.minecraftDeMiFicha(
    pedir("/api/mi-ficha/minecraft", {
      cuerpo: { token, slug: "luna", accion: "codigo" },
      token: null,
    }),
    { ejecutor: e, db: DB },
  );
  expect(r.status).toBe(200);
  return (await r.json()).codigo.codigo as string;
}

beforeEach(async () => {
  e = ejecutorSqlite(new DatabaseSync(":memory:"));
  await conTablas(e);
  await e.execute(
    "INSERT INTO solicitud (tipo, estado, datos, contacto, red, terminos_version, terminos_aceptados_en, creado, vtuber_slug) VALUES ('inscripcion','aprobada','{}', ?, 'r','v','2026-01-01','2026-01-01','luna')",
    [JSON.stringify({ email: "luna@example.com" })],
  );
});

afterEach(() => vi.restoreAllMocks());

describe("token del servidor", () => {
  test("sin token, con otro o sin configurar, las rutas del plugin no existen (404)", async () => {
    const cuerpo = { codigo: "ABCDEFGH", uuid: JUGADOR };
    expect(
      (
        await mc.vincularDesdeElJuego(
          pedir("/api/minecraft/vincular", { cuerpo, token: null }),
          { ejecutor: e, db: DB, env: ENV },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await mc.vincularDesdeElJuego(
          pedir("/api/minecraft/vincular", {
            cuerpo,
            token: "otro-token-cualquiera-x",
          }),
          { ejecutor: e, db: DB, env: ENV },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await mc.vincularDesdeElJuego(
          pedir("/api/minecraft/vincular", { cuerpo }),
          { ejecutor: e, db: DB, env: {} },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await mc.vincularDesdeElJuego(
          pedir("/api/minecraft/vincular", { cuerpo, token: "corto" }),
          { ejecutor: e, db: DB, env: { VTUBERDEX_MINECRAFT_TOKEN: "corto" } },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await mc.recibirXp(
          pedir("/api/minecraft/xp", { cuerpo: {}, token: null }),
          { ejecutor: e, db: DB, env: ENV },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await mc.jugador(
          pedir(`/api/minecraft/jugador/${JUGADOR}`, {
            metodo: "GET",
            token: null,
          }),
          JUGADOR,
          { ejecutor: e, db: DB, env: ENV },
        )
      ).status,
    ).toBe(404);
  });
});

describe("repartir puntos de stats desde el juego", () => {
  const STATS = [
    { slug: "hp", label: "HP", value: 1000, max: 1000 },
    { slug: "attack", label: "Ataque", value: 100 },
    { slug: "speed", label: "Velocidad", value: 50 },
  ];
  const repartir = (cuerpo: unknown, token: string | null = TOKEN) =>
    mc.repartirDesdeElJuego(pedir("/api/minecraft/puntos", { cuerpo, token }), {
      ejecutor: e,
      db: DB,
      env: ENV,
    });
  const progreso = async () =>
    (
      await (
        await mc.jugador(
          pedir(`/api/minecraft/jugador/${JUGADOR}`, { metodo: "GET" }),
          JUGADOR,
          { ejecutor: e, db: DB, env: ENV },
        )
      ).json()
    ).progreso;

  beforeEach(async () => {
    FICHAS.luna.stats = STATS as never[];
    const codigo = await codigoDeMiFicha(await enlaceDeMiFicha());
    await mc.vincularDesdeElJuego(
      pedir("/api/minecraft/vincular", {
        cuerpo: { codigo, uuid: JUGADOR, jugador: "LunaMC" },
      }),
      { ejecutor: e, db: DB, env: ENV },
    );
    // Un lote de 100 XP = el nivel 1 entero = 10 puntos de stats.
    await mc.recibirXp(
      pedir("/api/minecraft/xp", {
        cuerpo: {
          uuid: JUGADOR,
          idLote: randomUUID(),
          detalle: { mob: 60, tiempo: 40 },
        },
      }),
      { ejecutor: e, db: DB, env: ENV, avisar: async () => true },
    );
  });
  afterEach(() => {
    FICHAS.luna.stats = [];
  });

  test("sin token no existe (404)", async () => {
    expect((await repartir({ uuid: JUGADOR, stat: "hp" }, null)).status).toBe(
      404,
    );
  });

  test("gasta de a uno o varios y el panel ve los puntos que quedan", async () => {
    expect((await progreso()).puntosStats).toBe(10);
    const uno = await repartir({ uuid: JUGADOR, stat: "hp" });
    expect(await uno.json()).toEqual({
      ok: true,
      aplicados: 1,
      puntosStats: 9,
    });
    const cinco = await repartir({
      uuid: JUGADOR,
      stat: "attack",
      cantidad: 5,
    });
    expect(await cinco.json()).toEqual({
      ok: true,
      aplicados: 5,
      puntosStats: 4,
    });
    expect((await progreso()).puntosStats).toBe(4);
  });

  test("si faltan puntos a mitad aplica los que alcanzan; sin ninguno, 409", async () => {
    const r = await repartir({ uuid: JUGADOR, stat: "hp", cantidad: 50 });
    expect(await r.json()).toEqual({ ok: true, aplicados: 10, puntosStats: 0 });
    const vacio = await repartir({ uuid: JUGADOR, stat: "hp" });
    expect(vacio.status).toBe(409);
    expect((await vacio.json()).error).toBe("sin_puntos_stats");
  });

  test("un stat que no se compra (automático o inexistente) da 404 y no gasta nada", async () => {
    const r = await repartir({ uuid: JUGADOR, stat: "speed" });
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBe("stat_no_encontrado");
    expect((await progreso()).puntosStats).toBe(10);
  });

  test("datos inválidos (400) y cuenta sin vínculo (404)", async () => {
    for (const cuerpo of [
      {},
      { uuid: "x", stat: "hp" },
      { uuid: JUGADOR },
      { uuid: JUGADOR, stat: "hp", cantidad: 0 },
      { uuid: JUGADOR, stat: "hp", cantidad: 1.5 },
      { uuid: JUGADOR, stat: "hp", cantidad: 51 },
    ]) {
      expect((await repartir(cuerpo)).status).toBe(400);
    }
    const ajeno = await repartir({
      uuid: "61699b2e-d327-4a01-9f1e-0ea8c3f06bc6",
      stat: "hp",
    });
    expect(ajeno.status).toBe(404);
    expect((await ajeno.json()).error).toBe("sin_vinculo");
  });
});

describe("vínculo y XP de punta a punta", () => {
  test("código en «Mi ficha» → vincular en el juego → la XP sube el nivel de la ficha", async () => {
    const enlace = await enlaceDeMiFicha();
    const codigo = await codigoDeMiFicha(enlace);

    const vinculo = await mc.vincularDesdeElJuego(
      pedir("/api/minecraft/vincular", {
        cuerpo: { codigo, uuid: JUGADOR, jugador: "LunaMC" },
      }),
      { ejecutor: e, db: DB, env: ENV },
    );
    expect(vinculo.status).toBe(200);
    expect(await vinculo.json()).toMatchObject({
      ok: true,
      slug: "luna",
      name: "Luna",
    });

    const quien = await mc.jugador(
      pedir(`/api/minecraft/jugador/${JUGADOR}`, { metodo: "GET" }),
      JUGADOR,
      { ejecutor: e, db: DB, env: ENV },
    );
    expect(await quien.json()).toMatchObject({
      vinculado: true,
      slug: "luna",
      progreso: {
        xpHoy: 0,
        topeDia: XP_JUEGO_MAX_DIA,
        puntosHabilidad: 0,
        puntosStats: 0,
      },
    });

    const avisar = vi.fn(async () => true);
    const lote = {
      uuid: JUGADOR,
      idLote: randomUUID(),
      detalle: { mob: 60, tiempo: 40 },
    };
    const xp = await mc.recibirXp(
      pedir("/api/minecraft/xp", { cuerpo: lote }),
      { ejecutor: e, db: DB, env: ENV, avisar },
    );
    expect(await xp.json()).toMatchObject({
      ok: true,
      sumado: 100,
      duplicado: false,
      hoy: 100,
      topeDia: XP_JUEGO_MAX_DIA,
      slug: "luna",
    });
    await vi.waitFor(() =>
      expect(avisar).toHaveBeenCalledWith(
        expect.objectContaining({ xpJuego: 100 }),
      ),
    );

    // El panel del juego ve el progreso al día: 100 XP de juego hoy y los puntos del nivel ganado (3 de habilidad, 10 de stats).
    const despues = await (
      await mc.jugador(
        pedir(`/api/minecraft/jugador/${JUGADOR}`, { metodo: "GET" }),
        JUGADOR,
        { ejecutor: e, db: DB, env: ENV },
      )
    ).json();
    expect(despues.progreso).toMatchObject({
      xpJuego: 100,
      xpHoy: 100,
      puntosHabilidad: 3,
      puntosStats: 10,
    });

    // El reintento del mismo lote no suma ni vuelve a avisar.
    const otra = await mc.recibirXp(
      pedir("/api/minecraft/xp", { cuerpo: lote }),
      { ejecutor: e, db: DB, env: ENV, avisar },
    );
    expect(await otra.json()).toMatchObject({
      sumado: 100,
      duplicado: true,
      hoy: 100,
    });
    expect(avisar).toHaveBeenCalledTimes(1);

    // «Mi ficha» ve el vínculo, la XP y el nivel ganado (100 XP = el nivel 1 entero = 3 puntos).
    const vista = await (
      await miFicha.estadoDeMiFicha(
        pedir("/api/mi-ficha", { cuerpo: { token: enlace }, token: null }),
        { ejecutor: e, db: DB },
      )
    ).json();
    expect(vista.ficha.minecraft).toMatchObject({
      vinculado: true,
      jugador: "LunaMC",
      xpJuego: 100,
    });
    expect(vista.ficha.level).toBe(2);
    expect(vista.ficha.puntos.ganados).toBe(3);
  });

  test("el código no se puede canjear dos veces y un lote sin vínculo da 404 sin_vinculo", async () => {
    const codigo = await codigoDeMiFicha(await enlaceDeMiFicha());
    const cuerpo = { codigo, uuid: JUGADOR };
    expect(
      (
        await mc.vincularDesdeElJuego(
          pedir("/api/minecraft/vincular", { cuerpo }),
          { ejecutor: e, db: DB, env: ENV },
        )
      ).status,
    ).toBe(200);
    const repetido = await mc.vincularDesdeElJuego(
      pedir("/api/minecraft/vincular", { cuerpo }),
      { ejecutor: e, db: DB, env: ENV },
    );
    expect(repetido.status).toBe(410);
    expect((await repetido.json()).error).toBe("codigo_caducado");

    const ajeno = {
      uuid: "61699b2e-d327-4a01-9f1e-0ea8c3f06bc6",
      idLote: randomUUID(),
      detalle: { mob: 5 },
    };
    const r = await mc.recibirXp(
      pedir("/api/minecraft/xp", { cuerpo: ajeno }),
      { ejecutor: e, db: DB, env: ENV, avisar: async () => true },
    );
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBe("sin_vinculo");
  });

  test("desvincular desde «Mi ficha» y desde el juego", async () => {
    const enlace = await enlaceDeMiFicha();
    await mc.vincularDesdeElJuego(
      pedir("/api/minecraft/vincular", {
        cuerpo: { codigo: await codigoDeMiFicha(enlace), uuid: JUGADOR },
      }),
      { ejecutor: e, db: DB, env: ENV },
    );
    const suelto = await miFicha.minecraftDeMiFicha(
      pedir("/api/mi-ficha/minecraft", {
        cuerpo: { token: enlace, slug: "luna", accion: "desvincular" },
        token: null,
      }),
      { ejecutor: e, db: DB },
    );
    expect((await suelto.json()).ficha.minecraft.vinculado).toBe(false);

    await mc.vincularDesdeElJuego(
      pedir("/api/minecraft/vincular", {
        cuerpo: { codigo: await codigoDeMiFicha(enlace), uuid: JUGADOR },
      }),
      { ejecutor: e, db: DB, env: ENV },
    );
    const desdeJuego = await mc.desvincularDesdeElJuego(
      pedir(`/api/minecraft/jugador/${JUGADOR}`, { metodo: "DELETE" }),
      JUGADOR,
      { ejecutor: e, env: ENV },
    );
    expect(await desdeJuego.json()).toEqual({ ok: true });
    expect(
      await (
        await mc.jugador(
          pedir(`/api/minecraft/jugador/${JUGADOR}`, { metodo: "GET" }),
          JUGADOR,
          { ejecutor: e, db: DB, env: ENV },
        )
      ).json(),
    ).toEqual({ vinculado: false });
  });

  test("«Mi ficha» solo da códigos para fichas propias y acciones conocidas", async () => {
    const enlace = await enlaceDeMiFicha();
    const ajena = await miFicha.minecraftDeMiFicha(
      pedir("/api/mi-ficha/minecraft", {
        cuerpo: { token: enlace, slug: "otra", accion: "codigo" },
        token: null,
      }),
      { ejecutor: e, db: DB },
    );
    expect(ajena.status).toBe(404);
    const rara = await miFicha.minecraftDeMiFicha(
      pedir("/api/mi-ficha/minecraft", {
        cuerpo: { token: enlace, slug: "luna", accion: "borrar-todo" },
        token: null,
      }),
      { ejecutor: e, db: DB },
    );
    expect(rara.status).toBe(400);
    const sinEnlace = await miFicha.minecraftDeMiFicha(
      pedir("/api/mi-ficha/minecraft", {
        cuerpo: { token: "x".repeat(43), slug: "luna", accion: "codigo" },
        token: null,
      }),
      { ejecutor: e, db: DB },
    );
    expect(sinEnlace.status).toBe(410);
  });
});

describe("/vtd email", () => {
  const enviados: Array<{ to: string; text: string }> = [];
  beforeEach(() => {
    enviados.length = 0;
    correo.__usarTransporte({
      sendMail: async (m: { to: string; text: string }) => {
        enviados.push(m);
        return {};
      },
    });
  });

  test("el correo trae un código por ficha que solo canjea la cuenta que lo pidió", async () => {
    const r = await mc.pedirCodigoPorCorreo(
      pedir("/api/minecraft/email", {
        cuerpo: { uuid: JUGADOR, jugador: "LunaMC", email: "Luna@Example.com" },
      }),
      { ejecutor: e, db: DB, env: ENV, esperar: true },
    );
    expect(await r.json()).toEqual({ ok: true });
    expect(enviados).toHaveLength(1);
    expect(enviados[0].to).toBe("luna@example.com");
    expect(enviados[0].text).toMatch(/LunaMC/);
    const codigo = enviados[0].text.match(/\/vtd codigo (\w{8})/)![1];

    const intruso = await mc.vincularDesdeElJuego(
      pedir("/api/minecraft/vincular", {
        cuerpo: { codigo, uuid: "61699b2e-d327-4a01-9f1e-0ea8c3f06bc6" },
      }),
      { ejecutor: e, db: DB, env: ENV },
    );
    expect(intruso.status).toBe(410);
    const dueña = await mc.vincularDesdeElJuego(
      pedir("/api/minecraft/vincular", { cuerpo: { codigo, uuid: JUGADOR } }),
      { ejecutor: e, db: DB, env: ENV },
    );
    expect(await dueña.json()).toMatchObject({ ok: true, slug: "luna" });
  });

  test("responde igual con un correo sin fichas, pero no le manda nada", async () => {
    const r = await mc.pedirCodigoPorCorreo(
      pedir("/api/minecraft/email", {
        cuerpo: { uuid: JUGADOR, email: "nadie@example.com" },
      }),
      { ejecutor: e, db: DB, env: ENV, esperar: true },
    );
    expect(await r.json()).toEqual({ ok: true });
    expect(enviados).toHaveLength(0);
  });

  test("sin token 404, correo inválido 400 y el segundo envío seguido 429", async () => {
    expect(
      (
        await mc.pedirCodigoPorCorreo(
          pedir("/api/minecraft/email", {
            cuerpo: { uuid: JUGADOR, email: "a@b.cl" },
            token: null,
          }),
          { ejecutor: e, db: DB, env: ENV },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await mc.pedirCodigoPorCorreo(
          pedir("/api/minecraft/email", {
            cuerpo: { uuid: JUGADOR, email: "nada" },
          }),
          { ejecutor: e, db: DB, env: ENV },
        )
      ).status,
    ).toBe(400);
    await mc.pedirCodigoPorCorreo(
      pedir("/api/minecraft/email", {
        cuerpo: { uuid: JUGADOR, email: "luna@example.com" },
      }),
      { ejecutor: e, db: DB, env: ENV, esperar: true },
    );
    const otra = await mc.pedirCodigoPorCorreo(
      pedir("/api/minecraft/email", {
        cuerpo: { uuid: JUGADOR, email: "luna@example.com" },
      }),
      { ejecutor: e, db: DB, env: ENV },
    );
    expect(otra.status).toBe(429);
    expect((await otra.json()).error).toBe("espera");
  });
});

describe("cuenta Java no premium (servidor offline)", () => {
  const OFFLINE = "5c1f7a2e-9b3d-3e4f-8a1b-2c3d4e5f6a7b";
  const conRed = (
    url: string,
    ip: string,
    opciones: { cuerpo?: unknown; metodo?: string } = {},
  ) => {
    const r = pedir(url, opciones);
    r.headers.set("x-jugador-red", ip);
    return r;
  };

  test("vinculada pero sin sesión en esa red: no entra ni ve de quién es la ficha", async () => {
    const codigo = await codigoDeMiFicha(await enlaceDeMiFicha());
    const ok = await mc.vincularDesdeElJuego(
      conRed("/api/minecraft/vincular", "200.1.2.3", {
        cuerpo: { codigo, uuid: OFFLINE, jugador: "Luna" },
      }),
      { ejecutor: e, db: DB, env: ENV },
    );
    expect(ok.status).toBe(200);

    const misma = await mc.jugador(
      conRed(`/api/minecraft/jugador/${OFFLINE}`, "200.1.2.3", {
        metodo: "GET",
      }),
      OFFLINE,
      { ejecutor: e, db: DB, env: ENV },
    );
    expect(await misma.json()).toMatchObject({ vinculado: true, slug: "luna" });

    // Mismo nombre (mismo UUID) desde otra red: como si no estuviera vinculada, y sin delatar la ficha.
    const otra = await mc.jugador(
      conRed(`/api/minecraft/jugador/${OFFLINE}`, "190.9.9.9", {
        metodo: "GET",
      }),
      OFFLINE,
      { ejecutor: e, db: DB, env: ENV },
    );
    expect(await otra.json()).toEqual({
      vinculado: false,
      necesitaSesion: true,
    });
  });

  test("sin la cabecera de red no se puede vincular una cuenta offline", async () => {
    const codigo = await codigoDeMiFicha(await enlaceDeMiFicha());
    const r = await mc.vincularDesdeElJuego(
      pedir("/api/minecraft/vincular", { cuerpo: { codigo, uuid: OFFLINE } }),
      { ejecutor: e, db: DB, env: ENV },
    );
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("falta_red");
  });

  test("sin sesión vigente la XP no suma", async () => {
    const r = await mc.recibirXp(
      pedir("/api/minecraft/xp", {
        cuerpo: { uuid: OFFLINE, idLote: randomUUID(), detalle: { mob: 5 } },
      }),
      { ejecutor: e, db: DB, env: ENV, avisar: async () => true },
    );
    expect(r.status).toBe(404);
  });
});

test("las reglas públicas salen de los mismos módulos que la web", () => {
  const r = mc.reglas();
  expect(r.xpJuego.maxDia).toBe(XP_JUEGO_MAX_DIA);
  expect(r.xpJuego.motivos).toContain("mob");
  expect(r.estados.length).toBeGreaterThan(30);
  expect(
    r.estados.find((x: { nombre: string }) => x.nombre === "Fortissimo"),
  ).toMatchObject({ color: "#d03e00", polaridad: "positivo" });
  expect(Object.keys(r.stats.mejorables)).toContain("hp");
});
