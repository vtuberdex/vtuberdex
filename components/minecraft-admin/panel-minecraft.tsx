"use client";

/**
 * Panel de `/minecraft-admin`: pedir el enlace mágico, ver los jars instalados, subir uno nuevo
 * y editar la configuración del servidor o de un plugin.
 *
 * Todo pasa por `/api/minecraft-admin/*`. Si la sesión no tiene el rol `mantenedor`, la API
 * responde 401 o 403 y el panel vuelve al formulario del correo: esconder los botones no sería
 * una protección, solo una molestia.
 */
import { useCallback, useEffect, useState } from "react";

type Estado = {
  plugins: string[];
  configuraciones: string[];
  servidor: boolean;
  directorio?: string;
};

type Sesion = "comprobando" | "dentro" | "fuera";

const ESTADO_VACIO: Estado = { plugins: [], configuraciones: [], servidor: false };

const leerError = async (r: Response, porDefecto: string) => {
  const cuerpo = (await r.json().catch(() => null)) as { error?: string } | null;
  return cuerpo?.error ?? porDefecto;
};

export function PanelMinecraftAdmin() {
  const [estado, setEstado] = useState<Estado>(ESTADO_VACIO);
  const [sesion, setSesion] = useState<Sesion>("comprobando");
  const [email, setEmail] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const [archivo, setArchivo] = useState<File | null>(null);
  const [destino, setDestino] = useState<"servidor" | "plugin">("servidor");
  const [nombreConfig, setNombreConfig] = useState("config.yml");
  const [texto, setTexto] = useState("");

  const cargar = useCallback(async () => {
    const r = await fetch("/api/minecraft-admin/estado", { cache: "no-store" });
    if (r.status === 401 || r.status === 403) {
      setSesion("fuera");
      return;
    }
    if (!r.ok) {
      setSesion("dentro");
      setError(await leerError(r, "no se pudo leer el estado"));
      return;
    }
    setSesion("dentro");
    setEstado((await r.json()) as Estado);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // El enlace mágico llega en el fragmento (`#t=...`): no viaja al servidor, y aquí se canjea.
  useEffect(() => {
    const trozo = window.location.hash.match(/t=([A-Za-z0-9_-]+)/);
    if (!trozo) return;
    const token = trozo[1];
    window.history.replaceState(null, "", window.location.pathname);
    void (async () => {
      const r = await fetch("/api/minecraft-admin/sesion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (r.ok) await cargar();
      else setError("el enlace caducó o ya se usó: pide otro");
    })();
  }, [cargar]);

  const pedirEnlace = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setError(null);
    setAviso(null);
    setOcupado(true);
    try {
      const r = await fetch("/api/minecraft-admin/enlace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!r.ok) throw new Error(await leerError(r, "no se pudo enviar el enlace"));
      setAviso("Si el correo puede administrar el servidor, el enlace va en camino.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "no se pudo enviar el enlace");
    } finally {
      setOcupado(false);
    }
  };

  const subir = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setError(null);
    setAviso(null);
    if (!archivo) {
      setError("elige un archivo .jar");
      return;
    }
    setOcupado(true);
    try {
      const nombre = encodeURIComponent(archivo.name);
      const r = await fetch(`/api/minecraft-admin/plugins?nombre=${nombre}`, {
        method: "POST",
        headers: { "content-type": "application/java-archive" },
        body: archivo,
      });
      if (!r.ok) throw new Error(await leerError(r, "no se pudo subir el plugin"));
      const meta = (await r.json()) as { plugin?: string };
      setAviso(`Plugin guardado: ${meta.plugin ?? archivo.name}`);
      setArchivo(null);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "no se pudo subir el plugin");
    } finally {
      setOcupado(false);
    }
  };

  const abrirConfiguracion = async () => {
    setError(null);
    setAviso(null);
    const parametros = new URLSearchParams({ tipo: destino });
    if (destino === "plugin") parametros.set("archivo", nombreConfig);
    const r = await fetch(`/api/minecraft-admin/configuracion?${parametros}`, {
      cache: "no-store",
    });
    if (!r.ok) {
      setError(await leerError(r, "no se pudo abrir la configuración"));
      return;
    }
    const cuerpo = (await r.json()) as { contenido?: string };
    setTexto(cuerpo.contenido ?? "");
  };

  const guardarConfiguracion = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setError(null);
    setAviso(null);
    setOcupado(true);
    try {
      const r = await fetch("/api/minecraft-admin/configuracion", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tipo: destino,
          archivo: destino === "plugin" ? nombreConfig : undefined,
          contenido: texto,
        }),
      });
      if (!r.ok) throw new Error(await leerError(r, "no se pudo guardar la configuración"));
      setAviso("Configuración guardada.");
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "no se pudo guardar la configuración");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-4xl space-y-8 px-4 py-10">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Mantenedor de Minecraft</h1>
        <p className="text-sm opacity-80">
          Sube jars de plugin y edita la configuración del servidor. El acceso se abre con un
          enlace de un solo uso enviado al correo del mantenedor.
        </p>
      </header>

      {sesion !== "dentro" ? (
        <section className="space-y-3 rounded border p-4">
          <h2 className="text-lg font-medium">Entrar con enlace mágico</h2>
          <form onSubmit={pedirEnlace} className="flex flex-col gap-3 sm:flex-row">
            <label className="flex-1 text-sm">
              <span className="sr-only">Correo</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="correo@example.com"
                className="w-full rounded border px-3 py-2"
              />
            </label>
            <button
              type="submit"
              disabled={ocupado}
              className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
            >
              Enviarme el enlace
            </button>
          </form>
        </section>
      ) : null}

      <>
          <section className="space-y-3 rounded border p-4">
            <h2 className="text-lg font-medium">Plugins instalados</h2>
            {estado.plugins.length === 0 ? (
              <p className="text-sm opacity-70">Todavía no hay jars subidos.</p>
            ) : (
              <ul className="list-inside list-disc text-sm">
                {estado.plugins.map((nombre) => (
                  <li key={nombre}>{nombre}</li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3 rounded border p-4">
            <h2 className="text-lg font-medium">Subir plugin</h2>
            <form onSubmit={subir} className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                type="file"
                accept=".jar"
                onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
                className="text-sm"
              />
              <button
                type="submit"
                disabled={ocupado}
                className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
              >
                Subir .jar
              </button>
            </form>
            <p className="text-xs opacity-70">Solo .jar, hasta 8 MB.</p>
          </section>

          <section className="space-y-3 rounded border p-4">
            <h2 className="text-lg font-medium">Configuración</h2>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="destino"
                  checked={destino === "servidor"}
                  onChange={() => setDestino("servidor")}
                />
                server.properties
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="destino"
                  checked={destino === "plugin"}
                  onChange={() => setDestino("plugin")}
                />
                Plugin (.yml)
              </label>
              {destino === "plugin" ? (
                <input
                  type="text"
                  value={nombreConfig}
                  onChange={(e) => setNombreConfig(e.target.value)}
                  className="rounded border px-2 py-1"
                  aria-label="Archivo del plugin"
                />
              ) : null}
              <button type="button" onClick={abrirConfiguracion} className="rounded border px-3 py-1">
                Abrir
              </button>
            </div>
            <form onSubmit={guardarConfiguracion} className="space-y-3">
              <textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                rows={14}
                spellCheck={false}
                aria-label="Contenido de la configuración"
                className="w-full rounded border p-3 font-mono text-xs"
              />
              <button
                type="submit"
                disabled={ocupado}
                className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
              >
                Guardar configuración
              </button>
            </form>
          </section>
      </>

      {aviso ? <p className="text-sm text-green-700">{aviso}</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </main>
  );
}
