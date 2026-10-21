// @vitest-environment node
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __reiniciarDirectos } from "./directos.mjs";
import { premiarDirectos } from "./premiar-directos.mjs";
import { xpDeJuego } from "../server/src/minecraft.mjs";
import { ejecutorSqlite } from "../server/src/solicitudes.mjs";

const ENV = { VTUBERDEX_TWITCH_ID_CLIENT: "a", VTUBERDEX_TWITCH_SECRET: "b", VTUBERDEX_KICK_ID_CLIENT: "c", VTUBERDEX_KICK_SECRET: "d" };
const json = (c: unknown) => new Response(JSON.stringify(c));

/** Twitch: solo `ana_vt` está en vivo. Kick: `bea_k` y `ana_k` lo están. */
const red = vi.fn(async (url: string) => {
  const u = String(url);
  if (u.includes("/token")) return json({ access_token: "T", expires_in: 3600 });
  if (u.includes("helix/streams")) {
    // Como Helix: responde solo los que están en vivo, con su `user_login`.
    const pedidos = new URL(u).searchParams.getAll("user_login");
    return json({ data: pedidos.includes("ana_vt") ? [{ type: "live", user_login: "ana_vt", title: "x", viewer_count: 1 }] : [] });
  }
  if (u.includes("api.kick.com")) return json({ data: [{ stream_title: "k", stream: { is_live: true, viewer_count: 2 } }] });
  throw new Error(`inesperada ${u}`);
});

beforeEach(() => {
  __reiniciarDirectos();
  red.mockClear();
});
afterEach(() => __reiniciarDirectos());

describe("premiarDirectos", () => {
  it("paga UNA vez a la ficha en directo aunque tenga varios canales, y no paga a las demás", async () => {
    const ejecutor = ejecutorSqlite(new DatabaseSync(":memory:"));
    const fichas = [
      { id: 1, socials: [{ url: "https://twitch.tv/ana_vt" }, { url: "https://kick.com/ana_k" }] },
      { id: 2, socials: [{ url: "https://twitch.tv/fuera_vt" }] },
      { id: 3, socials: [{ url: "https://youtube.com/@yt_sin_pagar" }, { url: "https://x.com/nada" }] },
    ];
    const ctx = { ejecutor, dia: "2026-10-21", opciones: { fetch: red as never, env: ENV as never }, ahora: Date.UTC(2026, 9, 21, 12) };
    const r = await premiarDirectos(fichas, ctx);
    expect(r).toMatchObject({ revisadas: 2, enDirecto: 1, pagadas: 1, xp: 5, errores: 0 });
    // Twitch se pregunta en UN lote para todos sus canales (ana_vt y fuera_vt), no uno por uno.
    expect(red.mock.calls.filter(([u]) => String(u).includes("helix/streams"))).toHaveLength(1);
    expect(await xpDeJuego(ejecutor, 1)).toBe(5);
    expect(await xpDeJuego(ejecutor, 2)).toBe(0);

    // Otra pasada en el mismo tramo no vuelve a pagar.
    const otra = await premiarDirectos(fichas, ctx);
    expect(otra.pagadas).toBe(0);
    expect(await xpDeJuego(ejecutor, 1)).toBe(5);
  });

  it("YouTube no paga (cuesta cuota) y un fallo de la plataforma no tumba la pasada", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const ejecutor = ejecutorSqlite(new DatabaseSync(":memory:"));
    const caida = vi.fn(async () => {
      throw new Error("caída");
    });
    const r = await premiarDirectos(
      [{ id: 1, socials: [{ url: "https://twitch.tv/ana_vt" }] }, { id: 2, socials: [{ url: "https://youtube.com/@yt_canal" }] }],
      { ejecutor, dia: "2026-10-21", opciones: { fetch: caida as never, env: ENV as never } },
    );
    expect(r).toMatchObject({ revisadas: 1, pagadas: 0, errores: 1 });
    expect(caida).toHaveBeenCalled();
  });
});
