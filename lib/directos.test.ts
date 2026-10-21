// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __reiniciarDirectos,
  canalDeUrl,
  canalesDeRedes,
  estadoDeCanal,
  estadoDeRedes,
  plataformaConfigurada,
  precalentarTwitch,
} from "./directos.mjs";

const ENV: Record<string, string | undefined> = {
  TWITCH_CLIENT_ID: "tid",
  TWITCH_CLIENT_SECRET: "tsec",
  KICK_CLIENT_ID: "kid",
  KICK_CLIENT_SECRET: "ksec",
  YOUTUBE_API_KEY: "yk",
};

type Opciones = NonNullable<Parameters<typeof estadoDeCanal>[1]>;
const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status });

beforeEach(() => __reiniciarDirectos());
afterEach(() => {
  __reiniciarDirectos();
  vi.restoreAllMocks();
});

describe("canalDeUrl", () => {
  it("reconoce el canal por el dominio, no por el nombre de la red", () => {
    expect(canalDeUrl("https://www.twitch.tv/MadKoding")).toMatchObject({
      plataforma: "twitch",
      clave: "madkoding",
    });
    expect(canalDeUrl("kick.com/madkoding")).toMatchObject({ plataforma: "kick", clave: "madkoding" });
    expect(canalDeUrl("https://youtube.com/@MadKoding")).toMatchObject({
      plataforma: "youtube",
      ref: { handle: "@madkoding" },
    });
    expect(canalDeUrl("https://www.youtube.com/channel/UC1234567890123456789012")).toMatchObject({
      ref: { id: "UC1234567890123456789012" },
    });
  });

  it("descarta lo que no es un canal o no se puede resolver barato", () => {
    for (const url of [
      "https://www.twitch.tv/directory",
      "https://www.twitch.tv/videos/123",
      "https://kick.com/categories",
      "https://www.youtube.com/watch?v=abcdefghijk",
      "https://www.youtube.com/c/Nombre",
      "https://youtube.com.evil.test/@x1234",
      "https://example.com/twitch",
      "javascript:alert(1)",
      "",
      null,
    ])
      expect(canalDeUrl(url as string)).toBeNull();
  });

  it("canalesDeRedes no repite el mismo canal", () => {
    const canales = canalesDeRedes([
      { platform: "Twitch", url: "https://twitch.tv/ana_vt" },
      { platform: "twitch", url: "https://www.twitch.tv/ANA_VT/" },
      { platform: "X", url: "https://x.com/ana" },
    ]);
    expect(canales).toHaveLength(1);
  });
});

describe("estadoDeCanal", () => {
  it("sin credenciales no llama a nadie", async () => {
    const f = vi.fn();
    const r = await estadoDeCanal(canalDeUrl("https://twitch.tv/ana_vt")!, { fetch: f as never, env: {} as never });
    expect(r.estado).toBe("sin_credenciales");
    expect(f).not.toHaveBeenCalled();
    expect(plataformaConfigurada("kick", {} as never)).toBe(false);
  });

  it("Twitch: en vivo con título y espectadores; pide el token UNA vez", async () => {
    const f = vi.fn(async (url: string) =>
      url.includes("oauth2/token")
        ? json({ access_token: "T", expires_in: 3600 })
        : json({
            data: [
              {
                type: "live",
                title: "Jugando\u0007 algo",
                viewer_count: 42,
                game_name: "Minecraft",
                started_at: "2026-10-21T10:00:00Z",
                thumbnail_url: "https://x.test/{width}x{height}.jpg",
              },
            ],
          }),
    );
    const ana = canalDeUrl("https://twitch.tv/ana_vt")!;
    const r = await estadoDeCanal(ana, { fetch: f as never, env: ENV as never });
    expect(r).toMatchObject({
      estado: "ok",
      enVivo: true,
      titulo: "Jugando  algo",
      espectadores: 42,
      categoria: "Minecraft",
      miniatura: "https://x.test/440x248.jpg",
    });
    await estadoDeCanal(canalDeUrl("https://twitch.tv/bea_vt")!, { fetch: f as never, env: ENV as never });
    expect(f.mock.calls.filter(([u]) => String(u).includes("oauth2/token"))).toHaveLength(1);
  });

  it("Twitch: sin stream = fuera de línea; un 401 renueva el token y reintenta una vez", async () => {
    let tokens = 0;
    let pedidos = 0;
    const f = vi.fn(async (url: string) => {
      if (url.includes("oauth2/token")) return json({ access_token: `T${++tokens}`, expires_in: 3600 });
      return ++pedidos === 1 ? json({}, 401) : json({ data: [] });
    });
    const r = await estadoDeCanal(canalDeUrl("https://twitch.tv/ana_vt")!, { fetch: f as never, env: ENV as never });
    expect(r).toMatchObject({ estado: "ok", enVivo: false });
    expect(tokens).toBe(2);
  });

  it("cachea, y las peticiones simultáneas comparten el trabajo", async () => {
    const f = vi.fn(async (url: string) =>
      url.includes("id.kick.com")
        ? json({ access_token: "K", expires_in: 3600 })
        : json({ data: [{ stream_title: "Hola", category: { name: "Just Chatting" }, stream: { is_live: true, viewer_count: 7, start_time: "2026-10-21T10:00:00Z" } }] }),
    );
    const canal = canalDeUrl("https://kick.com/ana_vt")!;
    let t = 1_000;
    const opciones: Opciones = { fetch: f as never, env: ENV as never, ahora: () => t };
    const [a, b] = await Promise.all([estadoDeCanal(canal, opciones), estadoDeCanal(canal, opciones)]);
    expect(a).toBe(b);
    expect(a).toMatchObject({ enVivo: true, titulo: "Hola", espectadores: 7, categoria: "Just Chatting" });
    const llamadas = f.mock.calls.length;
    await estadoDeCanal(canal, opciones);
    expect(f.mock.calls.length).toBe(llamadas); // desde caché
    t += 61_000;
    await estadoDeCanal(canal, opciones);
    expect(f.mock.calls.length).toBeGreaterThan(llamadas); // caducó
  });

  it("Kick: canal que no existe es error, no 'fuera de línea'", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const f = vi.fn(async (url: string) =>
      url.includes("id.kick.com") ? json({ access_token: "K", expires_in: 3600 }) : json({ data: [] }),
    );
    const r = await estadoDeCanal(canalDeUrl("https://kick.com/nadie")!, { fetch: f as never, env: ENV as never });
    expect(r.estado).toBe("error");
  });

  it("un fallo de red NO lanza y se recuerda un rato corto", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const f = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    const t = 0;
    const opciones: Opciones = { fetch: f as never, env: ENV as never, ahora: () => t };
    const canal = canalDeUrl("https://twitch.tv/ana_vt")!;
    expect((await estadoDeCanal(canal, opciones)).estado).toBe("error");
    const n = f.mock.calls.length;
    await estadoDeCanal(canal, opciones);
    expect(f.mock.calls.length).toBe(n);
  });

  it("YouTube: estadísticas, directo en curso y últimos vídeos", async () => {
    const f = vi.fn(async (url: string) => {
      if (url.includes("/channels?"))
        return json({
          items: [
            {
              statistics: { subscriberCount: "1200", viewCount: "99000", videoCount: "40" },
              contentDetails: { relatedPlaylists: { uploads: "UUabc" } },
            },
          ],
        });
      if (url.includes("/playlistItems?"))
        return json({ items: [{ contentDetails: { videoId: "aaaaaaaaaaa" } }, { contentDetails: { videoId: "bbbbbbbbbbb" } }] });
      return json({
        items: [
          {
            id: "aaaaaaaaaaa",
            snippet: { title: "Directo", liveBroadcastContent: "live", thumbnails: { medium: { url: "https://i.ytimg.com/a.jpg" } } },
            liveStreamingDetails: { concurrentViewers: "15", actualStartTime: "2026-10-21T10:00:00Z" },
          },
          {
            id: "bbbbbbbbbbb",
            snippet: { title: "Vídeo", liveBroadcastContent: "none", publishedAt: "2026-10-01T00:00:00Z", thumbnails: { medium: { url: "http://inseguro.test/b.jpg" } } },
            statistics: { viewCount: "300" },
          },
        ],
      });
    });
    const r = await estadoDeCanal(canalDeUrl("https://youtube.com/@ana_vt")!, { fetch: f as never, env: ENV as never });
    expect(r).toMatchObject({
      estado: "ok",
      enVivo: true,
      titulo: "Directo",
      espectadores: 15,
      enlace: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
      estadisticas: { suscriptores: 1200, vistas: 99000, videos: 40 },
    });
    expect(r.videos).toEqual([
      { id: "bbbbbbbbbbb", titulo: "Vídeo", publicado: "2026-10-01T00:00:00.000Z", miniatura: null, vistas: 300, url: "https://www.youtube.com/watch?v=bbbbbbbbbbb" },
    ]);
    expect(f.mock.calls.every(([u]) => !String(u).includes("/search?"))).toBe(true);
  });

  it("YouTube: suscriptores ocultos salen como null", async () => {
    const f = vi.fn(async () =>
      json({ items: [{ statistics: { hiddenSubscriberCount: true, viewCount: "5", videoCount: "1" } }] }),
    );
    const r = await estadoDeCanal(canalDeUrl("https://youtube.com/@ana_vt")!, { fetch: f as never, env: ENV as never });
    expect(r.estadisticas.suscriptores).toBeNull();
  });
});

describe("estadoDeRedes", () => {
  it("consulta solo las redes soportadas", async () => {
    const f = vi.fn(async () => json({ data: [] }));
    const r = await estadoDeRedes(
      [
        { platform: "X", url: "https://x.com/ana" },
        { platform: "Twitch", url: "https://twitch.tv/ana_vt" },
      ],
      { fetch: f as never, env: { ...ENV } as never },
    );
    expect(r).toHaveLength(1);
    expect(r[0].plataforma).toBe("twitch");
  });
});

describe("precalentarTwitch", () => {
  const canales = (n: number) =>
    Array.from({ length: n }, (_, i) => canalDeUrl(`https://twitch.tv/canal_${String(i).padStart(3, "0")}`)!);

  test("pregunta de a 100 logins y deja la caché lista: estadoDeCanal ya no llama", async () => {
    const f = vi.fn(async (url: string) => {
      if (url.includes("oauth2/token")) return json({ access_token: "T", expires_in: 3600 });
      const pedidos = new URL(url).searchParams.getAll("user_login");
      // Solo el 5 y el 150 están en vivo.
      return json({ data: pedidos.filter((l) => l === "canal_005" || l === "canal_150").map((l) => ({ type: "live", user_login: l, title: l, viewer_count: 3 })) });
    });
    const todos = canales(250);
    await precalentarTwitch(todos, { fetch: f as never, env: ENV as never });
    const llamadas = f.mock.calls.filter(([u]) => String(u).includes("helix/streams"));
    expect(llamadas).toHaveLength(3); // 100 + 100 + 50
    for (const [u] of llamadas) expect(new URL(String(u)).searchParams.getAll("user_login").length).toBeLessThanOrEqual(100);

    const antes = f.mock.calls.length;
    const vivo = await estadoDeCanal(todos[5], { fetch: f as never, env: ENV as never });
    const fuera = await estadoDeCanal(todos[6], { fetch: f as never, env: ENV as never });
    expect(vivo).toMatchObject({ estado: "ok", enVivo: true, titulo: "canal_005", espectadores: 3 });
    expect(fuera).toMatchObject({ estado: "ok", enVivo: false });
    expect(f.mock.calls.length).toBe(antes);
    // Una segunda pasada con todo vigente no vuelve a preguntar.
    await precalentarTwitch(todos, { fetch: f as never, env: ENV as never });
    expect(f.mock.calls.length).toBe(antes);
  });

  test("si el lote falla, los canales quedan en error (poco tiempo) y no cae a una llamada por canal", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const f = vi.fn(async (url: string) => {
      if (url.includes("oauth2/token")) return json({ access_token: "T", expires_in: 3600 });
      return json({}, 500);
    });
    const todos = canales(3);
    await precalentarTwitch(todos, { fetch: f as never, env: ENV as never });
    const antes = f.mock.calls.length;
    expect((await estadoDeCanal(todos[0], { fetch: f as never, env: ENV as never })).estado).toBe("error");
    expect(f.mock.calls.length).toBe(antes);
  });

  test("sin credenciales de Twitch no hace nada", async () => {
    const f = vi.fn();
    await precalentarTwitch(canales(3), { fetch: f as never, env: {} as never });
    expect(f).not.toHaveBeenCalled();
  });
});
