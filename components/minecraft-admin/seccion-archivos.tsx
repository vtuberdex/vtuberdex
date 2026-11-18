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
  /** Falso en lo que se ve pero no se abre desde el panel (texturas, shaders, modelos, jars). */
  editable?: boolean;
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
  sin_permiso: "Borrar archivos del servidor es de admin y de mantenedor.",
  sin_espacio: "No queda espacio en disco.",
  extension_no_permitida:
    "Esa extensión no se sube: van .zip, .yml, .json, .txt, .properties, .toml, .csv, .bbmodel, .nbt, .mcmeta, shaders (.fsh, .vsh, .glsl, .frag, .vert, .geom) y texturas .png.",
  archivo_demasiado_grande: "El archivo pasa de los 50 MB.",
  archivo_vacio: "El archivo llegó vacío.",
  ya_existe: "Ya hay algo con ese nombre en la carpeta.",
  nombre_invalido:
    "Ese nombre no vale: van letras, números, espacio, punto, guion, guion bajo y / para separar carpetas.",
  ruta_no_permitida: "Las carpetas se crean dentro de plugins/.",
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

/**
 * El botón de borrar de una fila. El servidor deja una copia `.bak` al lado antes de borrar y aquí
 * se pregunta antes, así que un clic de más se recupera.
 */
function BotonBorrar({
  ruta,
  nombre,
  alBorrar,
}: Readonly<{
  ruta: string;
  nombre: string;
  alBorrar: (ruta: string, nombre: string) => void;
}>) {
  const borrar = () => alBorrar(ruta, nombre);
  return (
    <button
      type="button"
      onClick={borrar}
      title={`Borrar ${nombre}`}
      aria-label={`Borrar ${nombre}`}
      className="shrink-0 rounded px-1 text-dex-muted hover:bg-red-400/20 hover:text-red-400"
    >
      🗑
    </button>
  );
}

function FilaDeArchivo({
  archivo,
  abierto,
  alAbrir,
  alBorrar,
}: Readonly<{
  archivo: Archivo;
  abierto: boolean;
  alAbrir: (ruta: string) => void;
  alBorrar: (ruta: string, nombre: string) => void;
}>) {
  // Lo que no es texto se ve, para saber que está, pero no se abre ni se edita aquí.
  if (archivo.editable === false) {
    return (
      <li className="flex items-center gap-1">
        <span
          className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1 ${MONO} text-dex-muted`}
          title={`${archivo.ruta} · ${tamano(archivo.bytes)} · se ve, no se edita desde el panel`}
        >
          <span aria-hidden>📄</span>
          <span className="truncate">{archivo.nombre}</span>
          <span className="ml-auto shrink-0 text-[10px]">{tamano(archivo.bytes)}</span>
          <span className="shrink-0 text-[10px] uppercase">se ve</span>
        </span>
      </li>
    );
  }
  const abrir = () => alAbrir(archivo.ruta);
  const tono = abierto ? "bg-dex-panel-soft text-dex-accent" : "text-dex-ink";
  return (
    <li className="flex items-center gap-1">
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
      {archivo.escribible === false ? null : (
        <BotonBorrar ruta={archivo.ruta} nombre={archivo.nombre} alBorrar={alBorrar} />
      )}
    </li>
  );
}

/** Un .zip de la carpeta: solo se muestra (no se abre ni se descomprime). */
function FilaDeComprimido({
  comprimido,
  alBorrar,
}: Readonly<{
  comprimido: Archivo;
  alBorrar: (ruta: string, nombre: string) => void;
}>) {
  return (
    <li className="flex items-center gap-1">
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
      <BotonBorrar
        ruta={comprimido.ruta}
        nombre={comprimido.nombre}
        alBorrar={alBorrar}
      />
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
  alBorrar,
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
  alBorrar: (ruta: string, nombre: string) => void;
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
            alBorrar={alBorrar}
          />
        ))}
        {comprimidos.map((c) => (
          <FilaDeComprimido key={c.ruta} comprimido={c} alBorrar={alBorrar} />
        ))}
      </ul>
    </div>
  );
}

/** Mismo tope que un jar de plugin (50 MB): el servidor lo vuelve a comprobar. */
const LIMITE_SUBIDA_BYTES = 50 * 1024 * 1024;

const ERROR_SUBIR = "no se pudo subir el archivo";

/** Lo que el servidor acepta subir: comprimidos y archivos sueltos (configuración, modelos, pack). */
const EXTENSIONES_SUBIBLES =
  /\.(zip|ya?ml|json|txt|properties|toml|csv|bbmodel|nbt|mcmeta|fsh|vsh|glsl|frag|vert|geom|png)$/i;

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

/**
 * Un cuerpo sin las listas (una versión vieja del servidor o una respuesta parcial) no debe tumbar
 * la pestaña: se completa con la carpeta vacía.
 */
function normalizarContenido(cuerpo: unknown): Contenido {
  const c = (cuerpo ?? {}) as Partial<Contenido>;
  return {
    ...CONTENIDO_VACIO,
    ...c,
    ruta: c.ruta ?? "",
    migas: c.migas ?? [],
    carpetas: c.carpetas ?? [],
    archivos: c.archivos ?? [],
    comprimidos: c.comprimidos ?? [],
  };
}

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

/** Lo que impide subir el archivo elegido (antes de gastar la subida), o null si se puede intentar. */
function problemaDelArchivo(archivo: File): string | null {
  if (!EXTENSIONES_SUBIBLES.test(archivo.name)) {
    return "esa extensión no se sube: van .zip, .yml, .json, .txt, .properties, .toml, .csv, .bbmodel, .nbt, .mcmeta, .fsh, .vsh, .glsl, .frag, .vert, .geom y .png";
  }
  if (archivo.size === 0) {
    return "el archivo llegó vacío";
  }
  if (archivo.size > LIMITE_SUBIDA_BYTES) {
    return "el archivo pasa de los 50 MB";
  }
  return null;
}

function enviarArchivo(
  archivo: File,
  carpeta: string,
  sobrescribir: boolean,
) {
  const consulta = new URLSearchParams({ carpeta, nombre: archivo.name });
  if (sobrescribir) {
    consulta.set("sobrescribir", "1");
  }
  return fetch(`/api/minecraft-admin/archivos?${consulta}`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: archivo,
  });
}

/**
 * Sube el archivo y, si el nombre ya está (409 `ya_existe`), pregunta antes de reemplazarlo de una
 * vez, sin copia del anterior (así lo pidió el equipo). Devuelve null si se canceló.
 */
async function subirConfirmando(
  archivo: File,
  carpeta: string,
): Promise<Response | null> {
  const r = await enviarArchivo(archivo, carpeta, false);
  if (r.status !== 409) {
    return r;
  }
  const cuerpo = (await r.json().catch(() => null)) as {
    error?: string;
  } | null;
  if (cuerpo?.error !== "ya_existe") {
    throw new Error(ERROR_SUBIR);
  }
  const reemplaza = window.confirm(
    `Ya hay un «${archivo.name}» en esta carpeta. ¿Reemplazarlo? No se guarda copia del anterior.`,
  );
  return reemplaza ? enviarArchivo(archivo, carpeta, true) : null;
}

/** Formulario para subir un archivo (comprimido, modelo o texto) a la carpeta abierta. */
function FormularioSubida({
  archivo,
  deshabilitado,
  alElegir,
  alSubir,
}: Readonly<{
  archivo: File | null;
  deshabilitado: boolean;
  alElegir: (archivo: File | null) => void;
  alSubir: (evento: React.SubmitEvent) => void;
}>) {
  const elegir = (e: React.ChangeEvent<HTMLInputElement>) =>
    alElegir(e.target.files?.[0] ?? null);
  // Arrastrar y soltar: se queda con el primer archivo, igual que el selector.
  const soltar = (e: React.DragEvent<HTMLFormElement>) => {
    e.preventDefault();
    const soltado = e.dataTransfer?.files?.[0] ?? null;
    if (soltado) {
      alElegir(soltado);
    }
  };
  return (
    <form
      onSubmit={alSubir}
      onDragOver={(e) => e.preventDefault()}
      onDrop={soltar}
      className="space-y-2 rounded-xl border border-dex-line bg-dex-void/60 p-3"
    >
      <p className="text-xs text-dex-muted">
        Sube un archivo a esta carpeta (máximo 50 MB, igual que un jar):
        comprimidos <strong>.zip</strong> y archivos sueltos de configuración,
        modelo o resource pack (.yml, .json, .txt, .properties, .toml, .csv,
        .bbmodel, .nbt, .mcmeta, shaders .fsh/.vsh/.glsl y texturas .png).
        También vale arrastrarlo aquí. Los zips no se descomprimen solos y, si
        ya hay uno con ese nombre, se pregunta antes de reemplazarlo.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="file"
          accept=".zip,.yml,.yaml,.json,.txt,.properties,.toml,.csv,.bbmodel,.nbt,.mcmeta,.fsh,.vsh,.glsl,.frag,.vert,.geom,.png"
          aria-label="Archivo para subir"
          onChange={elegir}
          className="text-xs text-dex-ink"
        />
        <button
          type="submit"
          disabled={deshabilitado || !archivo}
          className={CLASE_BOTON.primario}
        >
          Subir archivo
        </button>
        {archivo ? (
          <span className={`text-[11px] text-dex-muted ${MONO}`}>
            {tamano(archivo.size)}
          </span>
        ) : null}
      </div>
    </form>
  );
}

/**
 * Formulario para crear una carpeta dentro de la abierta. El nombre admite varios tramos
 * (`assets/minecraft/shaders/core`) y se crean todos de una vez: montar así la ruta de un resource
 * pack son decenas de carpetas y de una en una no acaba nunca.
 */
function FormularioCarpeta({
  nombre,
  deshabilitado,
  alEscribir,
  alCrear,
}: Readonly<{
  nombre: string;
  deshabilitado: boolean;
  alEscribir: (nombre: string) => void;
  alCrear: (evento: React.SubmitEvent) => void;
}>) {
  const escribir = (e: React.ChangeEvent<HTMLInputElement>) =>
    alEscribir(e.target.value);
  return (
    <form
      onSubmit={alCrear}
      className="space-y-2 rounded-xl border border-dex-line bg-dex-void/60 p-3"
    >
      <p className="text-xs text-dex-muted">
        Crea una carpeta aquí dentro. Puedes pegar la ruta completa
        («assets/minecraft/shaders/core») y se crean todas de una vez.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={nombre}
          onChange={escribir}
          placeholder="nombre de la carpeta"
          aria-label="Nombre de la carpeta nueva"
          className={CLASE_CAMPO}
        />
        <button
          type="submit"
          disabled={deshabilitado || !nombre.trim()}
          className={CLASE_BOTON.primario}
        >
          Crear carpeta
        </button>
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
  const [archivo, setArchivo] = useState<File | null>(null);
  const [carpetaNueva, setCarpetaNueva] = useState("");

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
    setDatos(normalizarContenido(await r.json()));
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
   * Sube el archivo elegido a la carpeta abierta (zip, modelo o texto). Si el nombre ya está, el
   * servidor responde «ya existe» y se pregunta antes de reemplazarlo (`subirConfirmando`). Un zip
   * no se descomprime: se queda como archivo.
   */
  const subirArchivo = useCallback(
    async (evento: React.SubmitEvent) => {
      evento.preventDefault();
      setError(null);
      setAviso(null);
      if (!archivo) {
        setError("elige un archivo para subir");
        return;
      }
      const problema = problemaDelArchivo(archivo);
      if (problema) {
        setError(problema);
        return;
      }
      const carpeta = contenido.ruta;
      setOcupado(true);
      try {
        const r = await subirConfirmando(archivo, carpeta);
        if (r === null) {
          return;
        }
        if (!r.ok) {
          throw new Error(await leerError(r, ERROR_SUBIR));
        }
        const guardado = (await r.json()) as { nombre?: string };
        setAviso(
          `Guardado ${guardado.nombre ?? archivo.name}. Si es configuración o un modelo, recarga el plugin o reinicia para que lo lea; si es un zip, no se descomprime solo.`,
        );
        setArchivo(null);
        await cargar(carpeta);
      } catch (e) {
        setError(e instanceof Error ? e.message : ERROR_SUBIR);
      } finally {
        setOcupado(false);
      }
    },
    [archivo, contenido.ruta, cargar],
  );

  /**
   * Crea una carpeta en la carpeta abierta (admin y mantenedor). El nombre puede traer varios
   * tramos; si el servidor contesta `ya_existe`, no se toca nada y se cuenta en el aviso.
   */
  const crearLaCarpeta = useCallback(
    async (evento: React.SubmitEvent) => {
      evento.preventDefault();
      const nombre = carpetaNueva.trim();
      if (!nombre) {
        setError("escribe el nombre de la carpeta");
        return;
      }
      setError(null);
      setAviso(null);
      setOcupado(true);
      try {
        const r = await fetch("/api/minecraft-admin/archivos", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ carpeta: contenido.ruta, nombre }),
        });
        if (!r.ok) {
          throw new Error(await leerError(r, "no se pudo crear la carpeta"));
        }
        setCarpetaNueva("");
        const donde = contenido.ruta ? `${contenido.ruta}/${nombre}` : nombre;
        setAviso(`Creada la carpeta ${donde}.`);
        await cargar(contenido.ruta);
      } catch (e) {
        setError(e instanceof Error ? e.message : "no se pudo crear la carpeta");
      } finally {
        setOcupado(false);
      }
    },
    [carpetaNueva, contenido.ruta, cargar],
  );

  /**
   * Borra un archivo de la carpeta abierta (admin y mantenedor). Pregunta antes y, si era el que
   * estaba abierto, cierra el editor: el servidor deja una copia `.bak` al lado antes de borrar.
   */
  const borrar = useCallback(
    async (destino: string, nombre: string) => {
      const seguro = window.confirm(
        `¿Borrar «${nombre}»? En el servidor queda una copia .bak al lado, así que se puede recuperar.`,
      );
      if (!seguro) {
        return;
      }
      setError(null);
      setAviso(null);
      setOcupado(true);
      try {
        const r = await fetch(
          `/api/minecraft-admin/archivos?${new URLSearchParams({ ruta: destino })}`,
          { method: "DELETE" },
        );
        if (!r.ok) {
          throw new Error(await leerError(r, "no se pudo borrar"));
        }
        if (destino === ruta) {
          setRuta(null);
          setTexto("");
          setOriginal("");
        }
        setAviso(`Borrado ${destino} (queda ${destino}.bak).`);
        await cargar(contenido.ruta);
      } catch (e) {
        setError(e instanceof Error ? e.message : "no se pudo borrar");
      } finally {
        setOcupado(false);
      }
    },
    [ruta, contenido.ruta, cargar],
  );

  const borrarSinEsperar = useCallback(
    (destino: string, nombre: string) => void borrar(destino, nombre),
    [borrar],
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
          alBorrar={borrarSinEsperar}
        />

        <div className="space-y-3">
          {estaEnPlugins(contenido.ruta) ? (
            <>
              <FormularioCarpeta
                nombre={carpetaNueva}
                deshabilitado={ocupado || carpetaSoloLectura}
                alEscribir={setCarpetaNueva}
                alCrear={crearLaCarpeta}
              />
              <FormularioSubida
                archivo={archivo}
                deshabilitado={ocupado || carpetaSoloLectura}
                alElegir={setArchivo}
                alSubir={subirArchivo}
              />
            </>
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
