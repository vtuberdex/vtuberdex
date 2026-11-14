// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
"use client";

/**
 * Explorador de archivos del servidor: se navega CARPETA por carpeta (raíz, `plugins/<Plugin>` con
 * sus subcarpetas, `config/`), se abre un archivo y se guarda con copia `.bak`.
 *
 * Antes llegaba una lista plana con todo el servidor (hasta 4000 rutas) y había que buscarlas por
 * texto; con un servidor con MythicMobs, MMOItems y compañía eso eran cientos de líneas mezcladas.
 * El servidor decide qué se puede abrir, qué se puede escribir y valida al guardar; aquí solo se
 * pinta (`lib/minecraft-archivos.mjs`).
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { CLASE_BOTON, CLASE_CAMPO, CLASE_CAMPO_MONO, Seccion } from "./ui";

type Archivo = {
  ruta: string;
  nombre: string;
  bytes: number;
  modificado: string;
  escribible?: boolean;
};
type Carpeta = { nombre: string; ruta: string };
type Migaja = { nombre: string; ruta: string };
type Contenido = {
  ruta: string;
  migas: Migaja[];
  carpetas: Carpeta[];
  archivos: Archivo[];
  /** Solo aparecen dentro de `plugins/`: son los `.zip` que se pueden subir y reemplazar. */
  comprimidos?: Archivo[];
  escribible: boolean;
  legible: boolean;
};

const MENSAJES: Record<string, string> = {
  sin_permiso_escritura:
    "El panel puede leer esta carpeta pero no guardar: al servicio web le falta permiso de escritura en ella.",
  sin_espacio: "No queda espacio en disco.",
  extension_no_permitida: "Solo se pueden subir archivos .zip.",
  archivo_demasiado_grande: "El zip pasa de los 50 MB.",
};
const leerError = async (r: Response, porDefecto: string) => {
  const c = (await r.json().catch(() => null)) as {
    error?: string;
    detail?: string;
  } | null;
  if (!c?.error) {
    return porDefecto;
  }
  const amable = MENSAJES[c.error];
  if (amable) {
    return amable;
  }
  return c.detail ? `${c.error}: ${c.detail}` : c.error;
};

const tamano = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`;

const MONO = "font-[ui-monospace,SFMono-Regular,Menlo,Consolas,monospace]";

/** Un enlace de las migas o una carpeta: navegar a `ruta`. */
function BotonDeMiga({
  ruta,
  nombre,
  alNavegar,
}: Readonly<{ ruta: string; nombre: string; alNavegar: (ruta: string) => void }>) {
  const navegar = () => alNavegar(ruta);
  return (
    <button
      type="button"
      onClick={navegar}
      className="rounded px-1.5 py-0.5 text-dex-accent hover:bg-dex-panel-soft"
    >
      {nombre}
    </button>
  );
}

function FilaDeCarpeta({
  carpeta,
  alNavegar,
}: Readonly<{ carpeta: Carpeta; alNavegar: (ruta: string) => void }>) {
  const navegar = () => alNavegar(carpeta.ruta);
  return (
    <li>
      <button
        type="button"
        onClick={navegar}
        className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left ${MONO} text-dex-ink hover:bg-dex-panel-soft`}
        title={carpeta.ruta}
      >
        <span aria-hidden>📁</span>
        <span className="truncate">{carpeta.nombre}</span>
        <span className="ml-auto text-dex-muted">›</span>
      </button>
    </li>
  );
}

function FilaDeArchivo({
  archivo,
  abierto,
  alAbrir,
}: Readonly<{
  archivo: Archivo;
  abierto: boolean;
  alAbrir: (ruta: string) => void;
}>) {
  const abrir = () => alAbrir(archivo.ruta);
  const tono = abierto ? "bg-dex-panel-soft text-dex-accent" : "text-dex-ink";
  return (
    <li>
      <button
        type="button"
        onClick={abrir}
        className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left ${MONO} hover:bg-dex-panel-soft ${tono}`}
        title={archivo.ruta}
      >
        <span className="truncate">{archivo.nombre}</span>
        {archivo.escribible === false ? (
          <span className="ml-auto shrink-0 text-[10px] uppercase text-amber-400">
            solo lectura
          </span>
        ) : null}
      </button>
    </li>
  );
}

/** Un .zip de la carpeta: solo se muestra (no se abre ni se descomprime). */
function FilaDeComprimido({ comprimido }: Readonly<{ comprimido: Archivo }>) {
  return (
    <li>
      <span
        className={`flex items-center gap-1.5 rounded-lg px-2 py-1 ${MONO} text-dex-muted`}
        title={`${comprimido.ruta} · ${tamano(comprimido.bytes)} · se reemplaza subiendo otro con el mismo nombre`}
      >
        <span aria-hidden>📦</span>
        <span className="truncate">{comprimido.nombre}</span>
        <span className="ml-auto shrink-0 text-[10px]">
          {tamano(comprimido.bytes)}
        </span>
      </span>
    </li>
  );
}

/** Columna izquierda: migas, filtro y el contenido (ya filtrado) de la carpeta. */
function Explorador({
  migas,
  carpetas,
  archivos,
  comprimidos,
  ruta,
  filtro,
  alFiltrar,
  alNavegar,
  alAbrir,
}: Readonly<{
  migas: Migaja[];
  carpetas: Carpeta[];
  archivos: Archivo[];
  comprimidos: Archivo[];
  ruta: string | null;
  filtro: string;
  alFiltrar: (filtro: string) => void;
  alNavegar: (ruta: string) => void;
  alAbrir: (ruta: string) => void;
}>) {
  const filtrar = (e: React.ChangeEvent<HTMLInputElement>) =>
    alFiltrar(e.target.value);
  return (
    <div className="space-y-2">
      <nav
        aria-label="Carpeta actual"
        className={`flex flex-wrap items-center gap-1 text-xs ${MONO}`}
      >
        <BotonDeMiga ruta="" nombre="servidor" alNavegar={alNavegar} />
        {migas.map((m) => (
          <span key={m.ruta} className="flex items-center gap-1">
            <span className="text-dex-muted">/</span>
            <BotonDeMiga ruta={m.ruta} nombre={m.nombre} alNavegar={alNavegar} />
          </span>
        ))}
      </nav>

      <input
        type="search"
        value={filtro}
        onChange={filtrar}
        placeholder="Filtrar en esta carpeta"
        aria-label="Filtrar archivos"
        className={CLASE_CAMPO}
      />

      <ul
        aria-label="Contenido de la carpeta"
        className="max-h-[32rem] overflow-auto rounded-xl border border-dex-line bg-dex-void/60 p-1 text-xs"
      >
        {carpetas.length === 0 &&
        archivos.length === 0 &&
        comprimidos.length === 0 ? (
          <li className="p-2 text-dex-muted">Carpeta vacía.</li>
        ) : null}
        {carpetas.map((c) => (
          <FilaDeCarpeta key={c.ruta} carpeta={c} alNavegar={alNavegar} />
        ))}
        {archivos.map((a) => (
          <FilaDeArchivo
            key={a.ruta}
            archivo={a}
            abierto={a.ruta === ruta}
            alAbrir={alAbrir}
          />
        ))}
        {comprimidos.map((c) => (
          <FilaDeComprimido key={c.ruta} comprimido={c} />
        ))}
      </ul>
    </div>
  );
}

/** Mismo tope que un jar de plugin (50 MB): el servidor lo vuelve a comprobar. */
const LIMITE_ZIP_BYTES = 50 * 1024 * 1024;

const ERROR_SUBIR_ZIP = "no se pudo subir el zip";

/** Lo que se pinta mientras la primera carpeta no ha llegado: nada que filtrar, nada abierto. */
const CONTENIDO_VACIO: Contenido = {
  ruta: "",
  migas: [],
  carpetas: [],
  archivos: [],
  comprimidos: [],
  escribible: true,
  legible: true,
};

/** Navegar o abrir otro archivo con cambios sin guardar pide confirmación antes de tirarlos. */
const puedeDescartar = (sinGuardar: boolean) =>
  !sinGuardar || window.confirm("Hay cambios sin guardar. ¿Descartarlos?");

const filtrarPorNombre = <T extends { nombre: string }>(
  lista: T[] | undefined,
  f: string,
) => (lista ?? []).filter((x) => !f || x.nombre.toLowerCase().includes(f));

// La subida de zip solo tiene sentido dentro de `plugins/` (el servidor lo vuelve a exigir).
const estaEnPlugins = (ruta: string) =>
  ruta === "plugins" || ruta.startsWith("plugins/");

/** La carpeta o el archivo abierto no se pueden escribir: «Guardar» queda desactivado. */
const esSoloLectura = (carpetaSoloLectura: boolean, abierto?: Archivo) =>
  carpetaSoloLectura || abierto?.escribible === false;

/** Lo que impide subir el zip elegido (antes de gastar la subida), o null si se puede intentar. */
function problemaDelZip(zip: File): string | null {
  if (!/\.zip$/i.test(zip.name)) {
    return "solo se pueden subir archivos .zip";
  }
  if (zip.size === 0) {
    return "el archivo llegó vacío";
  }
  if (zip.size > LIMITE_ZIP_BYTES) {
    return "el zip pasa de los 50 MB";
  }
  return null;
}

function enviarZip(zip: File, carpeta: string, sobrescribir: boolean) {
  const consulta = new URLSearchParams({ carpeta, nombre: zip.name });
  if (sobrescribir) {
    consulta.set("sobrescribir", "1");
  }
  return fetch(`/api/minecraft-admin/archivos?${consulta}`, {
    method: "POST",
    headers: { "content-type": "application/zip" },
    body: zip,
  });
}

/**
 * Sube el zip y, si el nombre ya está (409 `ya_existe`), pregunta antes de reemplazarlo de una
 * vez, sin copia del anterior (así lo pidió el equipo). Devuelve null si se canceló.
 */
async function subirZipConfirmando(
  zip: File,
  carpeta: string,
): Promise<Response | null> {
  const r = await enviarZip(zip, carpeta, false);
  if (r.status !== 409) {
    return r;
  }
  const cuerpo = (await r.json().catch(() => null)) as {
    error?: string;
  } | null;
  if (cuerpo?.error !== "ya_existe") {
    throw new Error(ERROR_SUBIR_ZIP);
  }
  const reemplaza = window.confirm(
    `Ya hay un «${zip.name}» en esta carpeta. ¿Reemplazarlo? No se guarda copia del anterior.`,
  );
  return reemplaza ? enviarZip(zip, carpeta, true) : null;
}

/** Formulario para subir un `.zip` a la carpeta abierta (solo dentro de `plugins/`). */
function FormularioZip({
  zip,
  deshabilitado,
  alElegir,
  alSubir,
}: Readonly<{
  zip: File | null;
  deshabilitado: boolean;
  alElegir: (zip: File | null) => void;
  alSubir: (evento: React.SubmitEvent) => void;
}>) {
  const elegir = (e: React.ChangeEvent<HTMLInputElement>) =>
    alElegir(e.target.files?.[0] ?? null);
  return (
    <form
      onSubmit={alSubir}
      className="space-y-2 rounded-xl border border-dex-line bg-dex-void/60 p-3"
    >
      <p className="text-xs text-dex-muted">
        Subir un <strong>.zip</strong> a esta carpeta (máximo 50 MB, igual que
        un jar). Solo se aceptan comprimidos y no se descomprimen solos: si
        ya hay uno con ese nombre, se pregunta antes de reemplazarlo.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="file"
          accept=".zip,application/zip"
          aria-label="Zip para subir"
          onChange={elegir}
          className="text-xs text-dex-ink"
        />
        <button
          type="submit"
          disabled={deshabilitado || !zip}
          className={CLASE_BOTON.primario}
        >
          Subir zip
        </button>
        {zip ? (
          <span className={`text-[11px] text-dex-muted ${MONO}`}>
            {tamano(zip.size)}
          </span>
        ) : null}
      </div>
    </form>
  );
}

function MensajesDeArchivo({
  aviso,
  error,
}: Readonly<{ aviso: string | null; error: string | null }>) {
  return (
    <>
      {aviso ? <p className="text-sm text-emerald-400">{aviso}</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      ) : null}
    </>
  );
}

/** Columna derecha: el archivo abierto, su texto y el botón de guardar. */
function EditorDeArchivo({
  ruta,
  abierto,
  texto,
  sinGuardar,
  soloLectura,
  ocupado,
  alCambiarTexto,
  alGuardar,
  children,
}: Readonly<{
  ruta: string | null;
  abierto: Archivo | undefined;
  texto: string;
  sinGuardar: boolean;
  soloLectura: boolean;
  ocupado: boolean;
  alCambiarTexto: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  alGuardar: (evento: React.SubmitEvent) => void;
  children: React.ReactNode;
}>) {
  return (
    <form onSubmit={alGuardar} className="space-y-3">
      {soloLectura ? (
        <p
          role="alert"
          className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-xs text-amber-300"
        >
          Esta carpeta se puede leer pero no guardar: al servicio web le falta
          permiso de escritura en el servidor. Se puede abrir el archivo, pero
          «Guardar» está desactivado hasta que se arregle ese permiso.
        </p>
      ) : null}
      <input
        readOnly
        value={ruta ?? ""}
        placeholder="Elige un archivo de la carpeta"
        aria-label="Archivo abierto"
        className={CLASE_CAMPO_MONO}
      />
      {abierto ? (
        <p className="text-[11px] text-dex-muted">
          {tamano(abierto.bytes)} · modificado{" "}
          {new Date(abierto.modificado).toLocaleString("es")}
        </p>
      ) : null}
      <textarea
        value={texto}
        onChange={alCambiarTexto}
        rows={22}
        disabled={!ruta}
        spellCheck={false}
        aria-label="Contenido del archivo"
        className={`${CLASE_CAMPO} ${MONO} text-xs leading-relaxed`}
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={ocupado || !ruta || !sinGuardar || soloLectura}
          className={CLASE_BOTON.primario}
        >
          Guardar archivo
        </button>
        {sinGuardar ? (
          <span className="text-xs text-amber-400">Cambios sin guardar</span>
        ) : null}
      </div>
      {children}
    </form>
  );
}

export function SeccionArchivos() {
  const [datos, setDatos] = useState<Contenido | null>(null);
  const [filtro, setFiltro] = useState("");
  const [ruta, setRuta] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [original, setOriginal] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [zip, setZip] = useState<File | null>(null);

  const cargar = useCallback(async (destino: string) => {
    setError(null);
    const consulta = destino
      ? `?${new URLSearchParams({ carpeta: destino })}`
      : "";
    const r = await fetch(`/api/minecraft-admin/archivos${consulta}`, {
      cache: "no-store",
    });
    if (!r.ok) {
      setError(await leerError(r, "no se pudo listar la carpeta"));
      return;
    }
    setDatos((await r.json()) as Contenido);
  }, []);

  useEffect(() => {
    void cargar("");
  }, [cargar]);

  const sinGuardar = texto !== original;
  // Mientras no llega la primera carpeta se pinta una vacía: evita una pregunta `?.` por campo.
  const contenido = datos ?? CONTENIDO_VACIO;

  const navegar = useCallback(
    async (destino: string) => {
      if (!puedeDescartar(sinGuardar)) {
        return;
      }
      setAviso(null);
      setRuta(null);
      setTexto("");
      setOriginal("");
      setFiltro("");
      await cargar(destino);
    },
    [sinGuardar, cargar],
  );

  const abrir = useCallback(
    async (destino: string) => {
      if (!puedeDescartar(sinGuardar)) {
        return;
      }
      setError(null);
      setAviso(null);
      const r = await fetch(
        `/api/minecraft-admin/archivos?${new URLSearchParams({ ruta: destino })}`,
        { cache: "no-store" },
      );
      if (!r.ok) {
        setError(await leerError(r, "no se pudo abrir el archivo"));
        return;
      }
      const c = (await r.json()) as { contenido: string };
      setRuta(destino);
      setTexto(c.contenido);
      setOriginal(c.contenido);
    },
    [sinGuardar],
  );

  const guardar = useCallback(
    async (evento: React.SubmitEvent) => {
      evento.preventDefault();
      if (!ruta) {
        return;
      }
      setError(null);
      setAviso(null);
      setOcupado(true);
      try {
        const r = await fetch("/api/minecraft-admin/archivos", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ruta, contenido: texto }),
        });
        if (!r.ok) {
          throw new Error(await leerError(r, "no se pudo guardar"));
        }
        setOriginal(texto);
        setAviso(
          `Guardado ${ruta} (copia anterior en .bak). Recarga el plugin o reinicia para aplicar.`,
        );
        await cargar(contenido.ruta);
      } catch (e) {
        setError(e instanceof Error ? e.message : "no se pudo guardar");
      } finally {
        setOcupado(false);
      }
    },
    [ruta, texto, contenido.ruta, cargar],
  );

  const navegarSinEsperar = useCallback(
    (destino: string) => void navegar(destino),
    [navegar],
  );
  const abrirSinEsperar = useCallback(
    (destino: string) => void abrir(destino),
    [abrir],
  );
  const cambiarTexto = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => setTexto(e.target.value),
    [],
  );

  /**
   * Sube el `.zip` elegido a la carpeta abierta. Si el nombre ya está, el servidor responde
   * «ya existe» y se pregunta antes de reemplazarlo (`subirZipConfirmando`). Nunca se
   * descomprime: el zip se queda como archivo.
   */
  const subirZip = useCallback(
    async (evento: React.SubmitEvent) => {
      evento.preventDefault();
      setError(null);
      setAviso(null);
      if (!zip) {
        setError("elige un archivo .zip");
        return;
      }
      const problema = problemaDelZip(zip);
      if (problema) {
        setError(problema);
        return;
      }
      const carpeta = contenido.ruta;
      setOcupado(true);
      try {
        const r = await subirZipConfirmando(zip, carpeta);
        if (r === null) {
          return;
        }
        if (!r.ok) {
          throw new Error(await leerError(r, ERROR_SUBIR_ZIP));
        }
        const guardado = (await r.json()) as { nombre?: string };
        setAviso(
          `Zip guardado: ${guardado.nombre ?? zip.name}. Se queda en la carpeta tal cual; no se descomprime solo.`,
        );
        setZip(null);
        await cargar(carpeta);
      } catch (e) {
        setError(e instanceof Error ? e.message : ERROR_SUBIR_ZIP);
      } finally {
        setOcupado(false);
      }
    },
    [zip, contenido.ruta, cargar],
  );

  const f = filtro.trim().toLowerCase();
  const carpetas = useMemo(
    () => filtrarPorNombre(contenido.carpetas, f),
    [contenido, f],
  );
  const archivos = useMemo(
    () => filtrarPorNombre(contenido.archivos, f),
    [contenido, f],
  );
  const comprimidos = useMemo(
    () => filtrarPorNombre(contenido.comprimidos, f),
    [contenido, f],
  );

  const abierto = contenido.archivos.find((a) => a.ruta === ruta);
  const carpetaSoloLectura = contenido.escribible === false;
  const soloLectura = esSoloLectura(carpetaSoloLectura, abierto);

  return (
    <Seccion
      titulo="Archivos"
      bajada="Se navega carpeta por carpeta: plugins (cada uno con lo suyo), config/ y los yml de la raíz. Se valida al guardar y queda una copia .bak."
    >
      {contenido.legible === false ? (
        <p
          role="alert"
          className="rounded-xl border border-red-400/40 bg-red-400/10 p-3 text-sm text-red-400"
        >
          El panel no puede leer esa carpeta del servidor. Revisa que exista y que
          el servicio web tenga permiso para leerla.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
        <Explorador
          migas={contenido.migas}
          carpetas={carpetas}
          archivos={archivos}
          comprimidos={comprimidos}
          ruta={ruta}
          filtro={filtro}
          alFiltrar={setFiltro}
          alNavegar={navegarSinEsperar}
          alAbrir={abrirSinEsperar}
        />

        <div className="space-y-3">
          {estaEnPlugins(contenido.ruta) ? (
            <FormularioZip
              zip={zip}
              deshabilitado={ocupado || carpetaSoloLectura}
              alElegir={setZip}
              alSubir={subirZip}
            />
          ) : null}
          <EditorDeArchivo
            ruta={ruta}
            abierto={abierto}
            texto={texto}
            sinGuardar={sinGuardar}
            soloLectura={soloLectura}
            ocupado={ocupado}
            alCambiarTexto={cambiarTexto}
            alGuardar={guardar}
          >
            <MensajesDeArchivo aviso={aviso} error={error} />
          </EditorDeArchivo>
        </div>
      </div>
    </Seccion>
  );
}
