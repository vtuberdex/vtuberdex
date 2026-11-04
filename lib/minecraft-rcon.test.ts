import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

process.env.VTUBERDEX_ADMIN_EMAILS = "admin@example.com";
process.env.VTUBERDEX_MINECRAFT_MANTENEDORES = "mantenedor@example.com";

import { POST as rconPOST } from "../app/api/minecraft-admin/rcon/route.js";
import {
  COOKIE_MANTENEDOR,
  crearSesionMantenedor as crearSesionSinTipos,
  rolDeCorreo,
} from "./minecraft-admin.mjs";

// El módulo es `.mjs` sin tipos: se declara aquí lo que la prueba pasa.
const crearSesionMantenedor = crearSesionSinTipos as unknown as (opciones: {
  email?: string;
  role?: string;
}) => string | null;
import {
  ACCIONES,
  configuracionRcon,
  ejecutarAccion,
  paquete,
  prepararAccion,
} from "./minecraft-rcon.mjs";

const comando = (accion: string, datos: Record<string, unknown> = {}) => {
  const r = prepararAccion(accion, datos) as {
    ok: boolean;
    comando?: string;
    status?: number;
  };
  return r;
};

describe("acciones: no hay comando libre", () => {
  it("las acciones fijas producen siempre el mismo comando", () => {
    expect(comando("jugadores").comando).toBe("list");
    expect(comando("guardar").comando).toBe("save-all flush");
    expect(comando("dia").comando).toBe("time set day");
  });

  it("un campo «comando» enviado por el cliente se ignora", () => {
    expect(comando("jugadores", { comando: "op Steve" }).comando).toBe("list");
  });

  it("una acción que no existe se rechaza, también las del prototipo", () => {
    for (const nombre of [
      "op",
      "stop",
      "constructor",
      "__proto__",
      "toString",
      "",
    ]) {
      expect(comando(nombre).ok).toBe(false);
    }
  });

  it("reiniciar es un stop fijo: ignora lo que mande el cliente", () => {
    expect(
      comando("reiniciar", { comando: "op Steve", jugador: "x" }).comando,
    ).toBe("stop");
  });

  it("expulsar arma «kick jugador motivo»", () => {
    expect(
      comando("expulsar", { jugador: "Steve", motivo: "spam" }).comando,
    ).toBe("kick Steve spam");
    expect(comando("expulsar", { jugador: "Steve" }).comando).toBe(
      "kick Steve",
    );
  });

  it("el nombre del jugador no puede abrir otro comando", () => {
    for (const jugador of [
      "Steve op Alex",
      "Steve\nstop",
      "a;stop",
      "@a",
      "",
      "x".repeat(21),
      "Steve ",
    ]) {
      const r = comando("expulsar", { jugador });
      // «Steve » se recorta y es válido; el resto no.
      if (jugador === "Steve ") expect(r.ok).toBe(true);
      else expect(r.ok).toBe(false);
    }
  });

  it("el motivo y el anuncio son una sola línea sin control", () => {
    expect(
      comando("expulsar", { jugador: "Steve", motivo: "a\nstop" }).ok,
    ).toBe(false);
    expect(
      comando("expulsar", { jugador: "Steve", motivo: "x".repeat(121) }).ok,
    ).toBe(false);
    expect(comando("anunciar", { mensaje: "" }).ok).toBe(false);
    expect(comando("anunciar", { mensaje: "hola\r\nstop" }).ok).toBe(false);
    expect(comando("anunciar", { mensaje: "Reinicio en 5 min" }).comando).toBe(
      "say Reinicio en 5 min",
    );
  });

  it("ninguna acción puede producir op ni deop, y stop solo la acción fija «reiniciar»", () => {
    for (const nombre of Object.keys(ACCIONES)) {
      const r = comando(nombre, {
        jugador: "Steve",
        mensaje: "op",
        motivo: "stop",
      });
      const primero = String(r.comando ?? "").split(" ")[0];
      expect(["op", "deop"]).not.toContain(primero);
      if (primero === "stop") expect(nombre).toBe("reiniciar");
    }
  });

  it("vetar y quitar el veto son solo de admin", () => {
    expect(
      (prepararAccion("vetar", { jugador: "Steve" }) as { minimo: string })
        .minimo,
    ).toBe("admin");
    expect(
      (
        prepararAccion("quitar-veto", { jugador: "Steve" }) as {
          minimo: string;
        }
      ).minimo,
    ).toBe("admin");
    expect(
      (prepararAccion("expulsar", { jugador: "Steve" }) as { minimo: string })
        .minimo,
    ).toBe("mantenedor");
  });
});

describe("configuracionRcon", () => {
  it("sin contraseña no hay configuración", () => {
    expect(configuracionRcon({} as never)).toBeNull();
  });
  it("usa localhost y 25575 por defecto", () => {
    expect(
      configuracionRcon({ VTUBERDEX_MINECRAFT_RCON_PASSWORD: "x" } as never),
    ).toEqual({
      host: "127.0.0.1",
      puerto: 25575,
      clave: "x",
    });
  });
});

function falsoServidor(responder: (b: Buffer) => Buffer | null) {
  const enviados: Buffer[] = [];
  const conectar = () => {
    const s = new EventEmitter() as EventEmitter & Record<string, unknown>;
    s.setTimeout = () => s;
    s.destroy = () => s;
    s.write = (b: Buffer) => {
      enviados.push(b);
      const r = responder(b);
      if (r) queueMicrotask(() => s.emit("data", r));
      return true;
    };
    queueMicrotask(() => s.emit("connect"));
    return s;
  };
  return { conectar: conectar as never, enviados };
}

describe("ejecutarAccion", () => {
  it("sin contraseña responde 503 sin abrir ningún socket", async () => {
    const r = await ejecutarAccion("jugadores", {}, { env: {} as never });
    expect(r).toMatchObject({ ok: false, status: 503 });
  });

  it("autentica, manda el comando y devuelve la respuesta", async () => {
    const { conectar, enviados } = falsoServidor((b) =>
      paquete(
        b.readInt32LE(4),
        b.readInt32LE(8) === 3 ? 2 : 0,
        b.readInt32LE(8) === 3 ? "" : "2 jugadores",
      ),
    );
    const r = await ejecutarAccion(
      "jugadores",
      {},
      {
        env: { VTUBERDEX_MINECRAFT_RCON_PASSWORD: "secreta" } as never,
        conectar,
      },
    );
    expect(r).toMatchObject({
      ok: true,
      accion: "jugadores",
      comando: "list",
      respuesta: "2 jugadores",
    });
    expect(enviados).toHaveLength(2);
  });

  it("clave rechazada (id -1) es un error, no una respuesta", async () => {
    const { conectar } = falsoServidor(() => paquete(-1, 2, ""));
    const r = await ejecutarAccion(
      "jugadores",
      {},
      {
        env: { VTUBERDEX_MINECRAFT_RCON_PASSWORD: "mala" } as never,
        conectar,
      },
    );
    expect(r).toMatchObject({
      ok: false,
      cuerpo: { error: "rcon_clave_rechazada" },
    });
  });
});

describe("POST /api/minecraft-admin/rcon", () => {
  const cookie = (email: string) =>
    `${COOKIE_MANTENEDOR}=${encodeURIComponent(crearSesionMantenedor({ email }) ?? "")}`;
  const llamar = (cuerpo: unknown, c?: string) =>
    rconPOST(
      new Request("http://x/api/minecraft-admin/rcon", {
        method: "POST",
        headers: c ? { cookie: c } : {},
        body: JSON.stringify(cuerpo),
      }),
    );

  it("sin sesión responde 401", async () => {
    expect((await llamar({ accion: "jugadores" })).status).toBe(401);
  });

  it("un correo fuera de la lista responde 401 aunque la cookie esté firmada", async () => {
    expect(
      (await llamar({ accion: "jugadores" }, cookie("intruso@example.com")))
        .status,
    ).toBe(401);
  });

  it("el mantenedor no admin no puede vetar (403) pero sí expulsar", async () => {
    const vetar = await llamar(
      { accion: "vetar", jugador: "Steve" },
      cookie("mantenedor@example.com"),
    );
    expect(vetar.status).toBe(403);
    expect((await vetar.json()).error).toBe("solo_admin");
    // Sin contraseña RCON en el entorno de pruebas, expulsar llega hasta el 503: pasó el rol.
    const expulsar = await llamar(
      { accion: "expulsar", jugador: "Steve" },
      cookie("mantenedor@example.com"),
    );
    expect(expulsar.status).toBe(503);
  });

  it("un comando libre no tiene salida: «comando» no es una acción", async () => {
    const r = await llamar(
      { comando: "op Steve" },
      cookie("admin@example.com"),
    );
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("accion_desconocida");
  });

  it("un cuerpo que no es JSON responde 400", async () => {
    const r = await rconPOST(
      new Request("http://x/api/minecraft-admin/rcon", {
        method: "POST",
        headers: { cookie: cookie("admin@example.com") },
        body: "no json",
      }),
    );
    expect(r.status).toBe(400);
  });
});

describe("rolDeCorreo", () => {
  it("admin, mantenedor y fuera de la lista", () => {
    const env = {
      VTUBERDEX_ADMIN_EMAILS: "admin@example.com",
      VTUBERDEX_MINECRAFT_MANTENEDORES: "Mantenedor@Example.com",
    } as never;
    expect(rolDeCorreo("ADMIN@example.com", env)).toBe("admin");
    expect(rolDeCorreo("mantenedor@example.com", env)).toBe("mantenedor");
    expect(rolDeCorreo("otro@example.com", env)).toBeNull();
    expect(rolDeCorreo("", env)).toBeNull();
  });
  it("por defecto: los dos admin y Nero Schiffer como mantenedor", () => {
    expect(rolDeCorreo("madkoding@gmail.com", {} as never)).toBe("admin");
    expect(rolDeCorreo("ritcher.recomienda@gmail.com", {} as never)).toBe(
      "admin",
    );
    expect(rolDeCorreo("neroschiffer@gmail.com", {} as never)).toBe(
      "mantenedor",
    );
  });
  it("sin secreto en producción no hay sesión: no se firma con uno público", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VTUBERDEX_MANTENEDOR_SECRETO", "");
    expect(crearSesionMantenedor({ email: "admin@example.com" })).toBeNull();
    vi.unstubAllEnvs();
  });
});

describe("sinColores", () => {
  it("quita los códigos de color, incluidos los hexadecimales", async () => {
    const { sinColores } = await import("./minecraft-rcon.mjs");
    expect(
      sinColores(
        "§x§3§4§9§f§d§aℹ §fServer Plugins (13):\n §8- §aBlueMap§r, §aChunky§r",
      ),
    ).toBe("ℹ Server Plugins (13):\n - BlueMap, Chunky");
  });
});
