// @vitest-environment node
/**
 * Imágenes de las solicitudes: el servidor es MUY estricto con lo que acepta de un formulario público
 * (contenedor WebP verificado entero, medidas exactas, peso, cupos), cada imagen es de un solo correo y
 * NADA se queda si no se aprueba. Corre contra SQLite en memoria con el mismo SQL que Turso.
 */
import { DatabaseSync } from "node:sqlite";

import { beforeEach, describe, expect, test } from "vitest";

import {
  leerImagenDeSolicitud,
  subirImagenDeSolicitud,
} from "@/lib/solicitudes.mjs";
import {
  LIMITES,
  adjuntarImagenes,
  aplicarImagenesDeSolicitud,
  guardarImagen,
  huellaDeCorreo,
  imagenesDeSolicitud,
  leerImagen,
  purgarCaducadas,
  validarImagenesDeFormulario,
  validarMedidas,
  validarWebp,
} from "@/server/src/imagenes-solicitud.mjs";
import {
  SolicitudError,
  TERMINOS_VERSION,
  crearSolicitud,
  ejecutorSqlite,
  resolverSolicitud,
} from "@/server/src/solicitudes.mjs";
import { crearToken } from "@/server/src/verificacion.mjs";

import {
  SUBIR,
  conImagenes,
  riff,
  trozo,
  webp,
  webpDeTipo,
  webpExtendido,
} from "./test-imagenes";

let e: ReturnType<typeof ejecutorSqlite>;
beforeEach(() => {
  e = ejecutorSqlite(new DatabaseSync(":memory:"));
});

async function rechazo(promesa: Promise<unknown> | (() => unknown)) {
  try {
    await (typeof promesa === "function" ? promesa() : promesa);
  } catch (error) {
    return error as SolicitudError;
  }
  throw new Error("debía rechazarse");
}

const subir = (
  correo = "luna@example.com",
  tipo = "character",
  ip = "1.1.1.1",
) =>
  guardarImagen(e, {
    correo,
    tipo,
    formulario: "inscripcion",
    bytes: webpDeTipo(tipo as "character"),
    ip,
  });

describe("validarWebp: el contenedor se verifica entero", () => {
  test("acepta un WebP estático (sin pérdida, y extendido con alfa)", () => {
    expect(validarWebp(webp(720, 1008))).toEqual({ ancho: 720, alto: 1008 });
    expect(validarWebp(webpExtendido(720, 1008, 0x10))).toEqual({
      ancho: 720,
      alto: 1008,
    });
  });

  test.each([
    [
      "un PNG",
      Buffer.concat([
        Buffer.from("\x89PNG\r\n\x1a\n", "binary"),
        Buffer.alloc(60),
      ]),
    ],
    [
      "datos pegados al final (un archivo políglota)",
      Buffer.concat([webp(720, 1008), Buffer.from("<?php evil ?>")]),
    ],
    [
      "un tamaño RIFF que no es el real",
      (() => {
        const b = webp(720, 1008);
        b.writeUInt32LE(9999, 4);
        return b;
      })(),
    ],
    ["una animación", webpExtendido(720, 1008, 0x02)],
    ["metadatos EXIF (bandera)", webpExtendido(720, 1008, 0x08)],
    ["metadatos XMP (bandera)", webpExtendido(720, 1008, 0x04)],
    [
      "un trozo EXIF",
      riff(
        trozo("VP8L", Buffer.concat([Buffer.from([0x2f]), Buffer.alloc(11)])),
        trozo("EXIF", Buffer.from("gps")),
      ),
    ],
    [
      "dos imágenes",
      riff(
        trozo("VP8L", Buffer.concat([Buffer.from([0x2f]), Buffer.alloc(11)])),
        trozo("VP8L", Buffer.concat([Buffer.from([0x2f]), Buffer.alloc(11)])),
      ),
    ],
    ["un archivo vacío", Buffer.alloc(0)],
    ["un archivo cortado", webp(720, 1008).subarray(0, 20)],
  ])("rechaza %s", (_nombre, bytes) => {
    expect(() => validarWebp(bytes)).toThrow(SolicitudError);
  });

  test("rechaza lo que pesa más del máximo", () => {
    const grande = riff(
      trozo(
        "VP8L",
        Buffer.concat([Buffer.from([0x2f]), Buffer.alloc(LIMITES.maxBytes)]),
      ),
    );
    expect(() => validarWebp(grande)).toThrow(/pesa más/);
  });
});

describe("validarMedidas", () => {
  test("el personaje mide EXACTAMENTE el lienzo de la carta", () => {
    expect(() =>
      validarMedidas("character", { ancho: 720, alto: 1008 }),
    ).not.toThrow();
    for (const m of [
      { ancho: 721, alto: 1008 },
      { ancho: 720, alto: 1000 },
      { ancho: 1008, alto: 720 },
    ])
      expect(() => validarMedidas("character", m)).toThrow(SolicitudError);
  });

  test("el logo tiene entre 64 y 900 px por lado", () => {
    expect(() =>
      validarMedidas("logo", { ancho: 400, alto: 300 }),
    ).not.toThrow();
    expect(() =>
      validarMedidas("logo", { ancho: 900, alto: 64 }),
    ).not.toThrow();
    for (const m of [
      { ancho: 901, alto: 100 },
      { ancho: 100, alto: 63 },
      { ancho: 30, alto: 30 },
    ])
      expect(() => validarMedidas("logo", m)).toThrow(SolicitudError);
  });
});

describe("guardarImagen", () => {
  test("guarda, y NO guarda el correo en claro (solo una huella)", async () => {
    const r = await subir("Luna@Example.com");
    expect(r).toMatchObject({ tipo: "character", ancho: 720, alto: 1008 });
    const fila = (await e.execute("SELECT * FROM imagen_solicitud")).rows[0];
    expect(fila.huella).toBe(huellaDeCorreo("luna@example.com"));
    expect(JSON.stringify(fila)).not.toMatch(/luna/i);
  });

  test("subir otra del mismo tipo reemplaza la anterior (una por tipo y correo)", async () => {
    const a = await subir();
    const b = await subir();
    expect(a.id).not.toBe(b.id);
    expect(await leerImagen(e, a.id)).toBeNull();
    expect(await leerImagen(e, b.id)).not.toBeNull();
    await subir("luna@example.com", "logo");
    expect(
      (await e.execute("SELECT COUNT(*) n FROM imagen_solicitud")).rows[0].n,
    ).toBe(2);
  });

  test("rechaza un tipo desconocido y medidas que no son las del tipo", async () => {
    expect((await rechazo(subir("luna@example.com", "background"))).code).toBe(
      "tipo_invalido",
    );
    const mala = guardarImagen(e, {
      correo: "a@b.co",
      tipo: "character",
      formulario: "inscripcion",
      bytes: webp(800, 800),
      ip: "1.1.1.1",
    });
    expect((await rechazo(mala)).code).toBe("imagen_medidas");
  });

  test("tope de subidas por correo y por día", async () => {
    for (let i = 0; i < LIMITES.porCorreoDia; i++)
      await subir("luna@example.com", "character", `9.9.${i}.1`);
    const error = await rechazo(
      subir("luna@example.com", "character", "9.9.200.1"),
    );
    expect(error.status).toBe(429);
    // Otro correo no se ve afectado.
    await expect(
      subir("otra@example.com", "character", "9.9.201.1"),
    ).resolves.toBeTruthy();
  });

  test("tope de subidas por red y por día", async () => {
    for (let i = 0; i < LIMITES.porRedDia; i++)
      await subir(`p${i}@example.com`, "character", "7.7.7.7");
    expect(
      (await rechazo(subir("nuevo@example.com", "character", "7.7.7.7")))
        .status,
    ).toBe(429);
  });
});

describe("las imágenes son de UN correo", () => {
  test("solo las valida el dueño, del tipo correcto y mientras no estén en otra solicitud", async () => {
    const avatar = await subir("luna@example.com", "character");
    const logo = await subir("luna@example.com", "logo");
    const ok = await validarImagenesDeFormulario(e, {
      correo: "LUNA@example.com",
      imageId: avatar.id,
      logoId: logo.id,
      obligatorias: true,
    });
    expect(ok).toEqual([avatar.id, logo.id]);

    const ajeno = validarImagenesDeFormulario(e, {
      correo: "otra@example.com",
      imageId: avatar.id,
      logoId: logo.id,
      obligatorias: true,
    });
    expect((await rechazo(ajeno)).code).toBe("payload_invalido");
    const cruzado = validarImagenesDeFormulario(e, {
      correo: "luna@example.com",
      imageId: logo.id,
      logoId: avatar.id,
      obligatorias: true,
    });
    expect((await rechazo(cruzado)).code).toBe("payload_invalido");

    await adjuntarImagenes(e, 7, ok);
    const reutilizada = validarImagenesDeFormulario(e, {
      correo: "luna@example.com",
      imageId: avatar.id,
      logoId: logo.id,
      obligatorias: true,
    });
    expect((await rechazo(reutilizada)).code).toBe("payload_invalido");
  });

  test("falta una obligatoria → se señala el campo; opcional en blanco → no pasa nada", async () => {
    const error = await rechazo(
      validarImagenesDeFormulario(e, { correo: "a@b.co", obligatorias: true }),
    );
    expect(
      (error as unknown as { issues: Array<{ path: string }> }).issues[0].path,
    ).toBe("imageId");
    await expect(
      validarImagenesDeFormulario(e, { correo: "a@b.co", obligatorias: false }),
    ).resolves.toEqual([]);
  });
});

describe("caducidad: nada se queda si no se aprueba", () => {
  const nueva = async (correo: string) => {
    const entrada = await conImagenes(e, {
      name: "N",
      email: correo,
      imageId: SUBIR,
      logoId: SUBIR,
    } as Record<string, unknown>);
    return entrada;
  };
  const cuantas = async () =>
    Number(
      (await e.execute("SELECT COUNT(*) n FROM imagen_solicitud")).rows[0].n,
    );
  const dias = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

  test("lo que nunca se envió se borra a las 24 h", async () => {
    await nueva("a@example.com");
    expect(await cuantas()).toBe(2);
    await purgarCaducadas(e, dias(0.5));
    expect(await cuantas()).toBe(2);
    await purgarCaducadas(e, dias(1.1));
    expect(await cuantas()).toBe(0);
  });

  /** Una inscripción enviada de verdad, con sus dos imágenes adjuntas. */
  async function enviada(correo = "luna@example.com") {
    const { id } = await crearSolicitud(
      e,
      await conImagenes(e, {
        name: "Luna",
        email: correo,
        country: "chile",
        languages: ["es"],
        cardText: "x",
        height: "1",
        birthday: "1",
        favoriteFood: "a",
        dislikedFood: "b",
        favoriteGame: "c",
        favoriteSeries: "d",
        favoriteMusic: "e",
        favoriteAnime: "f",
        favoriteAnimal: "g",
        favoriteColor: "h",
        modeler: "m",
        hashtag: "#x",
        imageId: SUBIR,
        logoId: SUBIR,
        socials: [{ platform: "Twitch", url: "https://twitch.tv/x" }],
        aceptaTerminos: true,
        terminosVersion: TERMINOS_VERSION,
      } as Record<string, unknown>),
      { tipo: "inscripcion", ip: "1.1.1.1" },
    );
    await e.execute("UPDATE solicitud SET estado = 'pendiente' WHERE id = ?", [
      id,
    ]);
    return Number(id);
  }

  test("una solicitud que sigue pendiente conserva sus imágenes 30 días y luego las pierde", async () => {
    const id = await enviada();
    expect(await imagenesDeSolicitud(e, id)).toHaveLength(2);
    await purgarCaducadas(e, dias(29));
    expect(await imagenesDeSolicitud(e, id)).toHaveLength(2);
    await purgarCaducadas(e, dias(31));
    expect(await imagenesDeSolicitud(e, id)).toHaveLength(0);
  });

  test("rechazar borra las imágenes en el acto", async () => {
    const id = await enviada();
    await resolverSolicitud(e, id, { estado: "rechazada", actor: "admin" });
    expect(await cuantas()).toBe(0);
  });

  test("aprobar NO las borra (quien aprueba las copia y las borra); si no se aplicaron, caducan a los 7 días", async () => {
    const id = await enviada();
    await resolverSolicitud(e, id, { estado: "aprobada", actor: "admin" });
    expect(await imagenesDeSolicitud(e, id)).toHaveLength(2);
    await purgarCaducadas(e, dias(6));
    expect(await imagenesDeSolicitud(e, id)).toHaveLength(2);
    await purgarCaducadas(e, dias(8));
    expect(await imagenesDeSolicitud(e, id)).toHaveLength(0);
  });

  test("las de una solicitud que ya no existe también se limpian", async () => {
    const id = await enviada();
    await e.execute("DELETE FROM solicitud WHERE id = ?", [id]);
    await purgarCaducadas(e);
    expect(await cuantas()).toBe(0);
  });
});

describe("aplicarImagenesDeSolicitud (aprobar)", () => {
  async function conImagenesAdjuntas() {
    const a = await subir("luna@example.com", "character");
    const l = await subir("luna@example.com", "logo");
    await adjuntarImagenes(e, 5, [a.id, l.id]);
  }

  test("copia cada imagen y borra las copiadas", async () => {
    await conImagenesAdjuntas();
    const copiadas: Array<{
      tipo: string;
      ancho: number;
      alto: number;
      bytes: number;
    }> = [];
    const r = await aplicarImagenesDeSolicitud(
      e,
      5,
      async ({
        tipo,
        bytes,
        ancho,
        alto,
      }: {
        tipo: string;
        bytes: Buffer;
        ancho: number;
        alto: number;
      }) => {
        copiadas.push({ tipo, ancho, alto, bytes: bytes.length });
      },
    );
    expect(r).toEqual({ aplicadas: ["character", "logo"], fallidas: [] });
    expect(copiadas.map((c) => c.tipo)).toEqual(["character", "logo"]);
    expect(copiadas[0]).toMatchObject({ ancho: 720, alto: 1008 });
    expect(await imagenesDeSolicitud(e, 5)).toHaveLength(0);
  });

  test("si una falla, la aprobación no se rompe: se informa y esa imagen se conserva", async () => {
    await conImagenesAdjuntas();
    const r = await aplicarImagenesDeSolicitud(
      e,
      5,
      async ({ tipo }: { tipo: string }) => {
        if (tipo === "logo") throw new Error("almacén caído");
      },
    );
    expect(r.aplicadas).toEqual(["character"]);
    expect(r.fallidas).toEqual([{ tipo: "logo", error: "almacén caído" }]);
    expect(
      (await imagenesDeSolicitud(e, 5)).map((i: { tipo: string }) => i.tipo),
    ).toEqual(["logo"]);
  });
});

describe("HTTP público: subir y ver la vista previa", () => {
  const SESION_TIPO = "sesion";
  const subirHttp = async (
    credencial: string | null,
    {
      tipo = "character",
      cuerpo = webpDeTipo("character") as BodyInit,
      tipoMime = "image/webp",
      extra = {} as Record<string, string>,
    } = {},
  ) =>
    subirImagenDeSolicitud(
      new Request(`http://localhost/api/inscripciones/imagen?tipo=${tipo}`, {
        method: "POST",
        headers: {
          "content-type": tipoMime,
          ...(credencial ? { "x-credencial": credencial } : {}),
          ...extra,
        },
        body: cuerpo,
      }),
      "inscripcion",
      e,
    );
  const verHttp = (
    credencial: string | null,
    id: string,
    formulario: "inscripcion" | "modificacion" = "inscripcion",
  ) =>
    leerImagenDeSolicitud(
      new Request(`http://localhost/api/${formulario}/imagen?id=${id}`, {
        headers: credencial ? { "x-credencial": credencial } : {},
      }),
      formulario,
      e,
    );
  const credencial = (email = "luna@example.com", proposito = SESION_TIPO) =>
    crearToken(e, { proposito, email });

  test("con la sesión sube y responde 201, sin cachear", async () => {
    const r = await subirHttp(await credencial());
    expect(r.status).toBe(201);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toMatchObject({
      tipo: "character",
      ancho: 720,
      alto: 1008,
    });
  });

  test("sin credencial, con una caducada o con la de OTRO formulario: 410", async () => {
    expect((await subirHttp(null)).status).toBe(410);
    expect((await subirHttp("x".repeat(43))).status).toBe(410);
    // Un `permiso` (modificación) no sirve para subir en la inscripción.
    expect(
      (await subirHttp(await credencial("luna@example.com", "permiso"))).status,
    ).toBe(410);
  });

  test("solo WebP: otro tipo de contenido o bytes que no lo son se rechazan", async () => {
    const c = await credencial();
    expect((await subirHttp(c, { tipoMime: "image/png" })).status).toBe(415);
    expect(
      (
        await subirHttp(c, {
          cuerpo: Buffer.from("no soy una imagen" + "x".repeat(40)),
        })
      ).status,
    ).toBe(400);
    expect((await subirHttp(c, { tipo: "background" })).status).toBe(400);
  });

  test("un cuerpo demasiado grande se corta por el largo declarado, sin leerlo", async () => {
    const c = await credencial();
    const r = await subirHttp(c, {
      extra: { "content-length": String(LIMITES.maxBytes + 1) },
    });
    expect(r.status).toBe(413);
  });

  test("la vista previa solo la ve quien la subió, y a otro le da 404 igual que si no existiera", async () => {
    const c = await credencial();
    const { id } = (await (await subirHttp(c)).json()) as { id: string };
    const propia = await verHttp(c, id);
    expect(propia.status).toBe(200);
    expect(propia.headers.get("content-type")).toBe("image/webp");
    expect(propia.headers.get("x-content-type-options")).toBe("nosniff");
    expect(propia.headers.get("cache-control")).toBe("private, no-store");
    expect(
      (await verHttp(await credencial("otra@example.com"), id)).status,
    ).toBe(404);
    expect(
      (await verHttp(c, "11111111-1111-4111-8111-111111111111")).status,
    ).toBe(404);
    expect((await verHttp(c, "no-es-un-id")).status).toBe(404);
    expect((await verHttp(null, id)).status).toBe(410);
    // Y no sirve desde el formulario equivocado.
    expect(
      (
        await verHttp(
          await credencial("luna@example.com", "permiso"),
          id,
          "modificacion",
        )
      ).status,
    ).toBe(404);
  });
});
