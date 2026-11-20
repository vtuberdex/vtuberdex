// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
"use client";

/**
 * Pestaña «Archivos» de `/minecraft-admin`: un espacio de trabajo al estilo VS Code sobre TODA la
 * carpeta del servidor (antes había dos pestañas, «Plugins» y «Archivos», con listas cerradas).
 *
 * - Izquierda: explorador. Clic abre, clic derecho da el menú (nuevo, subir, instalar .zip,
 *   extraer, comprimir, renombrar, duplicar, mover, permisos, descargar, borrar, terminal aquí).
 *   Se arrastran archivos y carpetas desde el escritorio a cualquier carpeta, y dentro del árbol
 *   para moverlos. Los `.jar` de `plugins/` muestran si están activos y se activan desde aquí.
 * - Centro: Monaco con pestañas, Ctrl+S guarda; si el archivo cambió en el disco avisa.
 * - Abajo: terminal bash (redimensionable).
 *
 * Todo lo hace el agente `vtuberdex-mc-agente` como usuario `minecraft`; la API autoriza y anota.
 */
import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as EventoRaton,
  type ReactNode,
} from "react";

import { CLASE_BOTON, CLASE_CAMPO_MONO } from "../ui";
import {
  ErrorApi,
  accion,
  cambiarPlugin,
  esComprimido,
  esJar,
  guardar,
  leer,
  lenguajeDe,
  listar,
  listarPlugins,
  nombreDe,
  padre,
  registroDePlugin,
  subir,
  tamanoLegible,
  unir,
  urlDeDescarga,
  type Entrada,
  type Plugin,
} from "./api";
import { PanelTerminal } from "./panel-terminal";

const EditorCodigo = dynamic(
  () => import("./editor-codigo").then((m) => m.EditorCodigo),
  { ssr: false, loading: () => <p className="p-4 text-xs text-dex-muted">Cargando editor…</p> },
);

/* ------------------------------------------------------------------ */
/* Tipos                                                               */
/* ------------------------------------------------------------------ */

type Pestana =
  | {
      tipo: "texto";
      ruta: string;
      original: string;
      actual: string;
      modificado: number;
      modo: string;
      bytes: number;
    }
  | { tipo: "binario" | "grande"; ruta: string; bytes: number; modo: string }
  | { tipo: "plugin"; ruta: string };

type Menu = { x: number; y: number; ruta: string; entrada: Entrada | null };

type Dialogo =
  | { tipo: "nombre"; titulo: string; valor: string; aceptar: (v: string) => Promise<void> | void }
  | { tipo: "permisos"; ruta: string; modo: string; esCarpeta: boolean };

const esCarpeta = (e: Entrada | null) =>
  !e || e.tipo === "dir" || (e.tipo === "enlace" && Boolean(e.apuntaADir));

const comillas = (ruta: string) => `'${ruta.replaceAll("'", "'\\''")}'`;

/* ------------------------------------------------------------------ */
/* Iconos (texto, sin dependencias)                                    */
/* ------------------------------------------------------------------ */

function icono(e: Entrada, abierta: boolean) {
  if (esCarpeta(e)) {return abierta ? "📂" : "📁";}
  const n = e.nombre.toLowerCase();
  if (esJar(n)) {return "☕";}
  if (esComprimido(n)) {return "🗜️";}
  if (/\.(ya?ml|json|properties|toml|conf|cfg|ini)$/.test(n)) {return "⚙️";}
  if (/\.(png|jpe?g|gif|webp)$/.test(n)) {return "🖼️";}
  if (/\.(log|txt|md)$/.test(n) || n.endsWith(".log.gz")) {return "📄";}
  if (/\.(sh|py|js|mjs|sk)$/.test(n)) {return "📜";}
  return "📄";
}

const COLOR_PLUGIN: Record<Plugin["estado"], string> = {
  activo: "bg-emerald-400",
  deshabilitado: "bg-dex-muted",
  "pendiente-reinicio": "bg-amber-400",
  "sin-cargar": "bg-red-400",
  "sin-leer": "bg-red-400",
};
const TEXTO_PLUGIN: Record<Plugin["estado"], string> = {
  activo: "Activo",
  deshabilitado: "Desactivado",
  "pendiente-reinicio": "Desactivado, sigue cargado hasta reiniciar",
  "sin-cargar": "Activado pero no cargado (reinicia o revisa el registro)",
  "sin-leer": "No se pudo leer el jar",
};

/* ------------------------------------------------------------------ */
/* Subida de lo que se arrastra desde el escritorio                    */
/* ------------------------------------------------------------------ */

type ArchivoConRuta = { relativa: string; archivo: File };

async function archivosDeEntrada(entrada: FileSystemEntry, prefijo: string): Promise<ArchivoConRuta[]> {
  if (entrada.isFile) {
    const archivo = await new Promise<File>((ok, mal) => (entrada as FileSystemFileEntry).file(ok, mal));
    return [{ relativa: `${prefijo}${entrada.name}`, archivo }];
  }
  const lector = (entrada as FileSystemDirectoryEntry).createReader();
  const hijas: FileSystemEntry[] = [];
  // readEntries devuelve por tandas: se llama hasta que venga vacía.
  for (;;) {
    const tanda = await new Promise<FileSystemEntry[]>((ok, mal) => lector.readEntries(ok, mal));
    if (!tanda.length) {break;}
    hijas.push(...tanda);
  }
  const salida: ArchivoConRuta[] = [];
  for (const h of hijas) {salida.push(...(await archivosDeEntrada(h, `${prefijo}${entrada.name}/`)));}
  return salida;
}

async function archivosDelArrastre(ev: DragEvent): Promise<ArchivoConRuta[]> {
  const items = [...ev.dataTransfer.items].filter((i) => i.kind === "file");
  const entradas = items.map((i) => i.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
  if (entradas.length) {
    const todas: ArchivoConRuta[] = [];
    for (const e of entradas) {todas.push(...(await archivosDeEntrada(e, "")));}
    return todas;
  }
  return [...ev.dataTransfer.files].map((archivo) => ({ relativa: archivo.name, archivo }));
}

/* ------------------------------------------------------------------ */
/* Componente                                                          */
/* ------------------------------------------------------------------ */

export function EspacioArchivos() {
  const [carpetas, setCarpetas] = useState<Record<string, Entrada[]>>({});
  const [abiertas, setAbiertas] = useState<Set<string>>(() => new Set([""]));
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [pestanas, setPestanas] = useState<Pestana[]>([]);
  const [activa, setActiva] = useState<string | null>(null);
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; tono: "bien" | "mal" | "info" } | null>(null);
  const [destinoArrastre, setDestinoArrastre] = useState<string | null>(null);
  const [pedidoTerminal, setPedidoTerminal] = useState<{ texto: string; n: number } | null>(null);
  const [altoTerminal, setAltoTerminal] = useState(260);
  const [terminalVisible, setTerminalVisible] = useState(true);
  const [anchoArbol, setAnchoArbol] = useState(288);
  const [completa, setCompleta] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const entradaSubida = useRef<HTMLInputElement>(null);
  const entradaCarpeta = useRef<HTMLInputElement>(null);
  const entradaZip = useRef<HTMLInputElement>(null);
  const destinoSubida = useRef("");

  const avisar = useCallback((texto: string, tono: "bien" | "mal" | "info" = "info") => {
    setAviso({ texto, tono });
  }, []);
  const avisarError = useCallback(
    (e: unknown) => avisar(e instanceof Error ? e.message : String(e), "mal"),
    [avisar],
  );

  useEffect(() => {
    if (!aviso || aviso.tono === "mal") {return undefined;}
    const t = setTimeout(() => setAviso(null), 6000);
    return () => clearTimeout(t);
  }, [aviso]);

  /* ---------- datos ---------- */

  const cargarCarpeta = useCallback(
    async (ruta: string) => {
      try {
        const r = await listar(ruta);
        setCarpetas((c) => ({ ...c, [ruta]: r.entradas }));
      } catch (e) {
        avisarError(e);
      }
    },
    [avisarError],
  );

  const cargarPlugins = useCallback(async () => {
    setPlugins(await listarPlugins().catch(() => []));
  }, []);

  useEffect(() => {
    void cargarCarpeta("");
    void cargarPlugins();
  }, [cargarCarpeta, cargarPlugins]);

  /** Vuelve a listar las carpetas abiertas afectadas (o todas). */
  const refrescar = useCallback(
    async (...rutas: string[]) => {
      const objetivo = rutas.length ? new Set(rutas) : new Set(abiertas);
      await Promise.all([...objetivo].filter((r) => abiertas.has(r) || r === "").map((r) => cargarCarpeta(r)));
      if ([...objetivo].some((r) => r === "plugins" || r.startsWith("plugins/") || r === "")) {
        void cargarPlugins();
      }
    },
    [abiertas, cargarCarpeta, cargarPlugins],
  );

  const pluginDe = useCallback(
    (ruta: string) => (padre(ruta) === "plugins" ? plugins.find((p) => p.archivo === nombreDe(ruta)) : undefined),
    [plugins],
  );

  const entradaDe = useCallback(
    (ruta: string) => carpetas[padre(ruta)]?.find((e) => e.nombre === nombreDe(ruta)) ?? null,
    [carpetas],
  );

  /* ---------- árbol ---------- */

  const alternarCarpeta = (ruta: string) => {
    const n = new Set(abiertas);
    if (n.has(ruta)) {
      n.delete(ruta);
    } else {
      n.add(ruta);
      void cargarCarpeta(ruta);
    }
    setAbiertas(n);
  };

  const revelar = (ruta: string) => {
    const partes = ruta.split("/");
    const n = new Set(abiertas);
    for (let i = 1; i <= partes.length; i += 1) {
      const r = partes.slice(0, i).join("/");
      if (!n.has(r)) {
        n.add(r);
        void cargarCarpeta(r);
      }
    }
    setAbiertas(n);
    setSeleccion(ruta);
  };

  /* ---------- pestañas del editor ---------- */

  const abrirArchivo = async (ruta: string) => {
    setSeleccion(ruta);
    if (pestanas.some((p) => p.ruta === ruta)) {
      setActiva(ruta);
      return;
    }
    if (pluginDe(ruta)) {
      setPestanas((p) => [...p, { tipo: "plugin", ruta }]);
      setActiva(ruta);
      return;
    }
    try {
      const l = await leer(ruta);
      const nueva: Pestana =
        l.contenido !== undefined
          ? {
              tipo: "texto",
              ruta,
              original: l.contenido,
              actual: l.contenido,
              modificado: l.modificado,
              modo: l.modo,
              bytes: l.bytes,
            }
          : { tipo: l.binario ? "binario" : "grande", ruta, bytes: l.bytes, modo: l.modo };
      setPestanas((p) => [...p, nueva]);
      setActiva(ruta);
    } catch (e) {
      avisarError(e);
    }
  };

  const cerrarPestana = (ruta: string) => {
    const p = pestanas.find((x) => x.ruta === ruta);
    if (p?.tipo === "texto" && p.actual !== p.original && !window.confirm(`${nombreDe(ruta)} tiene cambios sin guardar. ¿Cerrar igual?`)) {
      return;
    }
    const resto = pestanas.filter((x) => x.ruta !== ruta);
    setPestanas(resto);
    if (activa === ruta) {setActiva(resto.at(-1)?.ruta ?? null);}
  };

  const guardarPestana = useCallback(
    async (ruta: string, forzar = false) => {
      const p = pestanas.find((x) => x.ruta === ruta);
      if (p?.tipo !== "texto") {return;}
      const contenido = p.actual;
      try {
        const r = await guardar(ruta, contenido, p.modificado, forzar);
        setPestanas((todas) =>
          todas.map((x) =>
            x.ruta === ruta && x.tipo === "texto"
              ? { ...x, original: contenido, modificado: r.modificado, bytes: r.bytes }
              : x,
          ),
        );
        avisar(`Guardado ${ruta}`, "bien");
        void refrescar(padre(ruta));
      } catch (e) {
        if (
          e instanceof ErrorApi &&
          e.codigo === "cambiado_en_disco" &&
          window.confirm(`${ruta} cambió en el disco desde que lo abriste (un plugin, la terminal u otra persona). ¿Sobrescribir con tu versión?`)
        ) {
          await guardarPestana(ruta, true);
          return;
        }
        avisarError(e);
      }
    },
    [pestanas, avisar, avisarError, refrescar],
  );

  const recargarPestana = async (ruta: string) => {
    try {
      const l = await leer(ruta);
      if (l.contenido === undefined) {return;}
      setPestanas((todas) => todas.filter((x) => x.ruta !== ruta));
      // El modelo de Monaco se queda con el texto viejo si se reutiliza la ruta en el mismo
      // render: se reabre en el siguiente.
      setTimeout(() => {
        setPestanas((todas) => [
          ...todas,
          { tipo: "texto", ruta, original: l.contenido ?? "", actual: l.contenido ?? "", modificado: l.modificado, modo: l.modo, bytes: l.bytes },
        ]);
        setActiva(ruta);
      }, 0);
    } catch (e) {
      avisarError(e);
    }
  };

  /* ---------- operaciones ---------- */

  const conOcupado = async (texto: string, fn: () => Promise<void>) => {
    setOcupado(texto);
    try {
      await fn();
    } catch (e) {
      avisarError(e);
    } finally {
      setOcupado(null);
    }
  };

  const subirVarios = async (carpeta: string, lista: ArchivoConRuta[]) => {
    if (!lista.length) {return;}
    let sobrescribirTodo: boolean | null = null;
    let hechos = 0;
    await conOcupado(`Subiendo 0/${lista.length}…`, async () => {
      for (const { relativa, archivo } of lista) {
        const destino = unir(carpeta, relativa);
        try {
          await subir(destino, archivo, sobrescribirTodo === true);
        } catch (e) {
          if (e instanceof ErrorApi && e.codigo === "ya_existe") {
            if (sobrescribirTodo === null) {
              sobrescribirTodo = window.confirm(
                `${destino} ya existe${lista.length > 1 ? " (y puede que otros más)" : ""}. ¿Reemplazar los que ya existan?`,
              );
            }
            if (sobrescribirTodo) {await subir(destino, archivo, true);}
          } else {
            throw e;
          }
        }
        hechos += 1;
        setOcupado(`Subiendo ${hechos}/${lista.length}…`);
      }
    });
    avisar(`Subidos ${hechos} archivo(s) a /${carpeta}`, "bien");
    setAbiertas((a) => new Set(a).add(carpeta));
    await cargarCarpeta(carpeta);
    for (const sub of new Set(lista.map((x) => padre(unir(carpeta, x.relativa))))) {
      if (abiertas.has(sub)) {void cargarCarpeta(sub);}
    }
    if (carpeta === "plugins") {void cargarPlugins();}
  };

  const instalarZip = async (carpeta: string, archivo: File) => {
    const temporal = unir(carpeta, `.subida-${Date.now()}-${archivo.name}`);
    await conOcupado(`Instalando ${archivo.name}…`, async () => {
      await subir(temporal, archivo, true);
      try {
        await accion({ accion: "descomprimir", ruta: temporal, destino: carpeta });
      } finally {
        await accion({ accion: "borrar", rutas: [temporal] }).catch(() => {});
      }
      avisar(`${archivo.name} extraído en /${carpeta}`, "bien");
    });
    setAbiertas((a) => new Set(a).add(carpeta));
    await refrescar(carpeta);
  };

  const mover = async (de: string, a: string, copiar = false) => {
    if (de === a) {return;}
    await conOcupado(copiar ? "Copiando…" : "Moviendo…", async () => {
      try {
        await accion({ accion: copiar ? "copiar" : "mover", de, a });
      } catch (e) {
        if (e instanceof ErrorApi && e.codigo === "ya_existe" && window.confirm(`${a} ya existe. ¿Reemplazarlo?`)) {
          await accion({ accion: copiar ? "copiar" : "mover", de, a, sobrescribir: true });
        } else {
          throw e;
        }
      }
      if (!copiar) {
        setPestanas((ps) => ps.filter((p) => p.ruta !== de && !p.ruta.startsWith(`${de}/`)));
      }
      setSeleccion(a);
    });
    await refrescar(padre(de), padre(a));
  };

  const borrar = async (ruta: string) => {
    const e = entradaDe(ruta);
    const que = esCarpeta(e) && e?.tipo !== "enlace" ? `la carpeta ${ruta} y TODO su contenido` : ruta;
    if (!window.confirm(`¿Borrar ${que}? No se puede deshacer.`)) {return;}
    await conOcupado("Borrando…", async () => {
      await accion({ accion: "borrar", rutas: [ruta] });
      setPestanas((ps) => ps.filter((p) => p.ruta !== ruta && !p.ruta.startsWith(`${ruta}/`)));
      avisar(`Borrado ${ruta}`, "bien");
    });
    await refrescar(padre(ruta));
  };

  const pedirNombre = (titulo: string, valor: string, aceptar: (v: string) => Promise<void> | void) =>
    setDialogo({ tipo: "nombre", titulo, valor, aceptar });

  const nuevoEn = (carpeta: string, tipo: "archivo" | "carpeta") =>
    pedirNombre(tipo === "archivo" ? `Nuevo archivo en /${carpeta}` : `Nueva carpeta en /${carpeta}`, "", async (nombre) => {
      const ruta = unir(carpeta, nombre);
      await accion({ accion: tipo, ruta });
      setAbiertas((a) => new Set(a).add(carpeta));
      await cargarCarpeta(carpeta);
      if (tipo === "archivo") {
        await abrirArchivo(ruta);
      } else {
        setSeleccion(ruta);
      }
    });

  const terminalEn = (carpeta: string) => {
    setTerminalVisible(true);
    setPedidoTerminal((p) => ({ texto: `cd ${comillas(`/srv/minecraft/${carpeta}`.replace(/\/$/, ""))}\r`, n: (p?.n ?? 0) + 1 }));
  };

  const alternarPlugin = async (ruta: string) => {
    const p = pluginDe(ruta);
    if (!p) {return;}
    await conOcupado(p.habilitado ? "Desactivando…" : "Activando…", async () => {
      await cambiarPlugin(p.archivo, !p.habilitado);
      avisar(
        `${p.nombre} ${p.habilitado ? "desactivado" : "activado"}. Se aplica al reiniciar el servidor (botón de la barra lateral).`,
        "bien",
      );
      setPestanas((ps) =>
        ps.map((x) =>
          x.ruta === ruta
            ? { ...x, ruta: p.habilitado ? `${ruta}.disabled` : ruta.replace(/\.disabled$/i, "") }
            : x,
        ),
      );
      if (activa === ruta) {setActiva(p.habilitado ? `${ruta}.disabled` : ruta.replace(/\.disabled$/i, ""));}
    });
    await refrescar("plugins");
  };

  /* ---------- arrastrar ---------- */

  const alArrastrarSobre = (ev: DragEvent, carpeta: string) => {
    ev.preventDefault();
    ev.stopPropagation();
    ev.dataTransfer.dropEffect = ev.dataTransfer.types.includes("application/x-mc-ruta")
      ? ev.ctrlKey || ev.altKey
        ? "copy"
        : "move"
      : "copy";
    setDestinoArrastre(carpeta);
  };

  const alSoltar = async (ev: DragEvent, carpeta: string) => {
    ev.preventDefault();
    ev.stopPropagation();
    setDestinoArrastre(null);
    const interna = ev.dataTransfer.getData("application/x-mc-ruta");
    if (interna) {
      if (carpeta === interna || carpeta.startsWith(`${interna}/`) || padre(interna) === carpeta) {return;}
      await mover(interna, unir(carpeta, nombreDe(interna)), ev.ctrlKey || ev.altKey);
      return;
    }
    try {
      const lista = await archivosDelArrastre(ev);
      await subirVarios(carpeta, lista);
    } catch (e) {
      avisarError(e);
    }
  };

  /* ---------- menú contextual ---------- */

  const abrirMenu = (ev: EventoRaton, ruta: string, entrada: Entrada | null) => {
    ev.preventDefault();
    ev.stopPropagation();
    setSeleccion(ruta);
    setMenu({ x: ev.clientX, y: ev.clientY, ruta, entrada });
  };

  useEffect(() => {
    if (!menu) {return undefined;}
    const cerrar = () => setMenu(null);
    window.addEventListener("click", cerrar);
    window.addEventListener("blur", cerrar);
    window.addEventListener("keydown", cerrar);
    return () => {
      window.removeEventListener("click", cerrar);
      window.removeEventListener("blur", cerrar);
      window.removeEventListener("keydown", cerrar);
    };
  }, [menu]);

  const elegirSubida = (carpeta: string, tipo: "archivos" | "carpeta" | "zip") => {
    destinoSubida.current = carpeta;
    ({ archivos: entradaSubida, carpeta: entradaCarpeta, zip: entradaZip })[tipo].current?.click();
  };

  type Opcion = { texto: string; atajo?: string; peligro?: boolean; hacer: () => void } | "—";

  const opcionesDe = (m: Menu): Opcion[] => {
    const { ruta, entrada } = m;
    const carpeta = esCarpeta(entrada);
    const dir = carpeta ? ruta : padre(ruta);
    const plugin = pluginDe(ruta);
    const ops: Opcion[] = [];
    if (!carpeta) {ops.push({ texto: "Abrir", hacer: () => void abrirArchivo(ruta) });}
    if (plugin) {
      ops.push({
        texto: plugin.habilitado ? "Desactivar plugin" : "Activar plugin",
        hacer: () => void alternarPlugin(ruta),
      });
    }
    if (carpeta) {
      ops.push(
        { texto: "Nuevo archivo…", hacer: () => nuevoEn(dir, "archivo") },
        { texto: "Nueva carpeta…", hacer: () => nuevoEn(dir, "carpeta") },
        "—",
        { texto: "Subir archivos…", hacer: () => elegirSubida(dir, "archivos") },
        { texto: "Subir carpeta…", hacer: () => elegirSubida(dir, "carpeta") },
        { texto: "Instalar .zip aquí (subir y extraer)…", hacer: () => elegirSubida(dir, "zip") },
        "—",
        { texto: "Abrir terminal aquí", hacer: () => terminalEn(dir) },
      );
    }
    if (!carpeta && esComprimido(ruta)) {
      ops.push(
        "—",
        { texto: "Extraer aquí", hacer: () => void conOcupado("Extrayendo…", async () => {
          await accion({ accion: "descomprimir", ruta, destino: dir });
          avisar(`Extraído en /${dir}`, "bien");
          await refrescar(dir);
        }) },
        { texto: `Extraer en «${nombreDe(ruta).replace(/\.(zip|tar\.gz|tgz|tar\.xz|txz|tar\.bz2|tbz2|tar)$/i, "")}/»`, hacer: () => void conOcupado("Extrayendo…", async () => {
          const destino = unir(dir, nombreDe(ruta).replace(/\.(zip|tar\.gz|tgz|tar\.xz|txz|tar\.bz2|tbz2|tar)$/i, ""));
          await accion({ accion: "descomprimir", ruta, destino });
          avisar(`Extraído en /${destino}`, "bien");
          await refrescar(dir);
          revelar(destino);
        }) },
      );
    }
    if (ruta) {
      ops.push(
        "—",
        { texto: "Renombrar…", atajo: "F2", hacer: () => pedirNombre(`Renombrar ${nombreDe(ruta)}`, nombreDe(ruta), (n) => mover(ruta, unir(padre(ruta), n))) },
        { texto: "Duplicar", hacer: () => {
          const n = nombreDe(ruta);
          const punto = carpeta || !n.includes(".") ? n.length : n.indexOf(".");
          void mover(ruta, unir(padre(ruta), `${n.slice(0, punto)} copia${n.slice(punto)}`), true);
        } },
        { texto: "Mover a…", hacer: () => pedirNombre(`Mover ${nombreDe(ruta)} a (ruta desde la raíz)`, ruta, (n) => mover(ruta, n.replace(/^\/+/, ""))) },
        { texto: "Comprimir en .zip", hacer: () => void conOcupado("Comprimiendo…", async () => {
          const destino = unir(padre(ruta), `${nombreDe(ruta)}.zip`);
          await accion({ accion: "comprimir", rutas: [ruta], destino });
          avisar(`Creado ${destino}`, "bien");
          await refrescar(padre(ruta));
        }) },
        { texto: "Permisos…", hacer: () => setDialogo({ tipo: "permisos", ruta, modo: entrada?.modo ?? "644", esCarpeta: carpeta }) },
      );
    }
    ops.push(
      "—",
      { texto: carpeta ? "Descargar (.tar.gz)" : "Descargar", hacer: () => window.open(urlDeDescarga(ruta), "_blank") },
      { texto: "Copiar ruta", hacer: () => void navigator.clipboard?.writeText(`/srv/minecraft/${ruta}`.replace(/\/$/, "")) },
      { texto: "Actualizar", hacer: () => void refrescar(dir) },
    );
    if (ruta) {ops.push("—", { texto: "Borrar", atajo: "Supr", peligro: true, hacer: () => void borrar(ruta) });}
    return ops;
  };

  /* ---------- teclado ---------- */

  const alTeclaArbol = (ev: React.KeyboardEvent) => {
    if (!seleccion) {return;}
    if (ev.key === "F2") {
      ev.preventDefault();
      pedirNombre(`Renombrar ${nombreDe(seleccion)}`, nombreDe(seleccion), (n) => mover(seleccion, unir(padre(seleccion), n)));
    } else if (ev.key === "Delete") {
      ev.preventDefault();
      void borrar(seleccion);
    }
  };

  /* ---------- redimensionar ---------- */

  const arrastrarDivisor = (eje: "x" | "y") => (ev: React.PointerEvent) => {
    ev.preventDefault();
    const inicio = eje === "y" ? ev.clientY : ev.clientX;
    const base = eje === "y" ? altoTerminal : anchoArbol;
    const mover = (e: PointerEvent) => {
      if (eje === "y") {
        setAltoTerminal(Math.min(Math.max(base + inicio - e.clientY, 120), window.innerHeight - 220));
      } else {
        setAnchoArbol(Math.min(Math.max(base + e.clientX - inicio, 180), 560));
      }
    };
    const soltar = () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  };

  /* ---------- render del árbol ---------- */

  const filas: ReactNode[] = [];
  const pintar = (carpeta: string, nivel: number) => {
    const entradas = carpetas[carpeta];
    if (!entradas) {
      filas.push(
        <div key={`${carpeta}/…`} style={{ paddingLeft: 12 + nivel * 14 }} className="py-0.5 text-dex-muted">
          …
        </div>,
      );
      return;
    }
    if (!entradas.length && nivel > 0) {
      filas.push(
        <div key={`${carpeta}/∅`} style={{ paddingLeft: 12 + nivel * 14 }} className="py-0.5 italic text-dex-muted">
          vacía
        </div>,
      );
    }
    for (const e of entradas) {
      const ruta = unir(carpeta, e.nombre);
      const dir = esCarpeta(e);
      const abierta = dir && abiertas.has(ruta);
      const plugin = pluginDe(ruta);
      const oculta = e.nombre.startsWith(".");
      filas.push(
        <div
          key={ruta}
          role="treeitem"
          aria-selected={seleccion === ruta}
          aria-expanded={dir ? abierta : undefined}
          tabIndex={-1}
          draggable
          onDragStart={(ev) => {
            ev.dataTransfer.setData("application/x-mc-ruta", ruta);
            ev.dataTransfer.effectAllowed = "copyMove";
          }}
          onDragOver={dir ? (ev) => alArrastrarSobre(ev, ruta) : (ev) => alArrastrarSobre(ev, carpeta)}
          onDragLeave={() => setDestinoArrastre(null)}
          onDrop={dir ? (ev) => void alSoltar(ev, ruta) : (ev) => void alSoltar(ev, carpeta)}
          onClick={() => (dir ? (setSeleccion(ruta), alternarCarpeta(ruta)) : void abrirArchivo(ruta))}
          onKeyDown={(ev) => {
            if (ev.key === "Enter" || ev.key === " ") {
              ev.preventDefault();
              ev.stopPropagation();
              const activar = () => (dir ? (setSeleccion(ruta), alternarCarpeta(ruta)) : void abrirArchivo(ruta));
              activar();
            }
          }}
          onContextMenu={(ev) => abrirMenu(ev, ruta, e)}
          title={`${ruta}\n${e.modo} · ${dir ? "carpeta" : tamanoLegible(e.bytes)}${e.destino ? `\n→ ${e.destino}` : ""}${plugin ? `\n${TEXTO_PLUGIN[plugin.estado]}` : ""}`}
          style={{ paddingLeft: 6 + nivel * 14 }}
          className={`flex cursor-pointer select-none items-center gap-1.5 whitespace-nowrap py-[3px] pr-2 ${
            seleccion === ruta ? "bg-dex-accent/15 text-dex-ink" : "hover:bg-dex-panel-soft"
          } ${destinoArrastre === ruta ? "outline outline-1 outline-dex-accent" : ""} ${oculta ? "opacity-60" : ""}`}
        >
          <span className="w-3 text-[10px] text-dex-muted">{dir ? (abierta ? "▾" : "▸") : ""}</span>
          <span aria-hidden>{icono(e, abierta)}</span>
          <span className={`truncate ${e.tipo === "enlace" ? "italic" : ""} ${plugin && !plugin.habilitado ? "text-dex-muted line-through" : ""}`}>
            {e.nombre}
          </span>
          {plugin ? (
            <span className={`ml-auto h-2 w-2 shrink-0 rounded-full ${COLOR_PLUGIN[plugin.estado]}`} aria-label={TEXTO_PLUGIN[plugin.estado]} />
          ) : null}
          {pestanas.some((p) => p.ruta === ruta && p.tipo === "texto" && p.actual !== p.original) ? (
            <span className="ml-auto text-dex-accent">●</span>
          ) : null}
        </div>,
      );
      if (abierta) {pintar(ruta, nivel + 1);}
    }
  };
  if (abiertas.has("")) {pintar("", 0);}

  const pestanaActiva = pestanas.find((p) => p.ruta === activa) ?? null;
  const entradaSeleccionada = seleccion ? entradaDe(seleccion) : null;

  const migas = useMemo(() => (activa ?? "").split("/").filter(Boolean), [activa]);

  return (
    <div
      className={
        completa
          ? "fixed inset-0 z-50 flex flex-col bg-dex-void"
          : "flex h-[calc(100vh-6rem)] min-h-[640px] flex-col overflow-hidden rounded-2xl border border-dex-line bg-dex-void"
      }
    >
      {/* Barra superior */}
      <div className="flex items-center gap-2 border-b border-dex-line bg-dex-panel/60 px-3 py-1.5 text-xs">
        <span className="font-bold text-dex-ink">/srv/minecraft</span>
        <span className="text-dex-muted">· explorador, editor y terminal</span>
        {ocupado ? <span className="ml-3 animate-pulse text-dex-accent">{ocupado}</span> : null}
        <div className="ml-auto flex gap-1">
          <button type="button" className={CLASE_BOTON.fantasma} onClick={() => setTerminalVisible((v) => !v)}>
            {terminalVisible ? "Ocultar terminal" : "Mostrar terminal"} <kbd className="opacity-60">Ctrl+`</kbd>
          </button>
          <button type="button" className={CLASE_BOTON.fantasma} onClick={() => setCompleta((c) => !c)}>
            {completa ? "Salir de pantalla completa" : "Pantalla completa"}
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Explorador */}
        <aside style={{ width: anchoArbol }} className="flex min-h-0 shrink-0 flex-col border-r border-dex-line bg-dex-panel/40">
          <div className="flex items-center gap-0.5 border-b border-dex-line/60 px-2 py-1 text-[11px]">
            <span className="mr-auto font-bold uppercase tracking-wide text-dex-muted">Explorador</span>
            {(
              [
                ["＋📄", "Nuevo archivo", () => nuevoEn(esCarpeta(entradaSeleccionada) ? (seleccion ?? "") : padre(seleccion ?? ""), "archivo")],
                ["＋📁", "Nueva carpeta", () => nuevoEn(esCarpeta(entradaSeleccionada) ? (seleccion ?? "") : padre(seleccion ?? ""), "carpeta")],
                ["⇪", "Subir archivos", () => elegirSubida(esCarpeta(entradaSeleccionada) ? (seleccion ?? "") : padre(seleccion ?? ""), "archivos")],
                ["⟳", "Actualizar", () => void refrescar()],
                ["⊟", "Contraer todo", () => setAbiertas(new Set([""]))],
              ] as const
            ).map(([txt, titulo, hacer]) => (
              <button key={titulo} type="button" title={titulo} aria-label={titulo} onClick={hacer} className="rounded px-1.5 py-0.5 text-dex-muted hover:bg-dex-panel-soft hover:text-dex-ink">
                {txt}
              </button>
            ))}
          </div>
          <div
            role="tree"
            aria-label="Archivos del servidor"
            tabIndex={0}
            onKeyDown={alTeclaArbol}
            onContextMenu={(ev) => abrirMenu(ev, "", null)}
            onDragOver={(ev) => alArrastrarSobre(ev, "")}
            onDrop={(ev) => void alSoltar(ev, "")}
            className={`min-h-0 flex-1 overflow-auto py-1 font-[ui-monospace,SFMono-Regular,Menlo,Consolas,monospace] text-[12.5px] text-dex-ink outline-none ${
              destinoArrastre === "" ? "bg-dex-accent/5" : ""
            }`}
          >
            {filas}
          </div>
          <p className="border-t border-dex-line/60 px-2 py-1 text-[10.5px] leading-snug text-dex-muted">
            Arrastra archivos o carpetas desde tu equipo a una carpeta. Arrastra dentro del árbol para mover (Ctrl = copiar). Clic derecho para más.
          </p>
        </aside>
        <div onPointerDown={arrastrarDivisor("x")} className="w-1 shrink-0 cursor-col-resize hover:bg-dex-accent/40" />

        {/* Editor + terminal */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex min-h-[34px] overflow-x-auto border-b border-dex-line bg-dex-panel/40 text-xs">
            {pestanas.map((p) => {
              const sucia = p.tipo === "texto" && p.actual !== p.original;
              return (
                <div
                  key={p.ruta}
                  className={`group flex items-center gap-2 border-r border-dex-line/60 px-3 ${
                    p.ruta === activa ? "bg-dex-void text-dex-ink" : "text-dex-muted hover:text-dex-ink"
                  }`}
                  onAuxClick={(ev) => ev.button === 1 && cerrarPestana(p.ruta)}
                >
                  <button type="button" onClick={() => { setActiva(p.ruta); setSeleccion(p.ruta); }} title={p.ruta} className="whitespace-nowrap py-2">
                    {nombreDe(p.ruta)}
                  </button>
                  <button
                    type="button"
                    aria-label={`Cerrar ${nombreDe(p.ruta)}`}
                    onClick={() => cerrarPestana(p.ruta)}
                    className={sucia ? "text-dex-accent" : "opacity-0 group-hover:opacity-100 hover:text-red-400"}
                  >
                    {sucia ? "●" : "×"}
                  </button>
                </div>
              );
            })}
          </div>
          {pestanaActiva ? (
            <div className="flex items-center gap-1 border-b border-dex-line/40 px-3 py-1 text-[11px] text-dex-muted">
              <span>minecraft</span>
              {migas.map((m, i) => (
                <span key={`${m}-${i}`}>
                  <span className="px-1 opacity-50">›</span>
                  {m}
                </span>
              ))}
              {pestanaActiva.tipo === "texto" ? (
                <span className="ml-auto flex gap-2">
                  <button type="button" className="hover:text-dex-ink" onClick={() => void recargarPestana(pestanaActiva.ruta)}>
                    Recargar del disco
                  </button>
                  <button
                    type="button"
                    disabled={pestanaActiva.actual === pestanaActiva.original}
                    className="font-bold text-dex-accent disabled:opacity-40"
                    onClick={() => void guardarPestana(pestanaActiva.ruta)}
                  >
                    Guardar (Ctrl+S)
                  </button>
                </span>
              ) : null}
            </div>
          ) : null}

          <div className="relative min-h-0 flex-1">
            {!pestanaActiva ? <Bienvenida /> : null}
            {pestanas.map((p) => (
              <div key={p.ruta} className={p.ruta === activa ? "absolute inset-0" : "hidden"}>
                {p.tipo === "texto" ? (
                  <EditorCodigo
                    ruta={p.ruta}
                    valorInicial={p.original}
                    lenguaje={lenguajeDe(p.ruta)}
                    alCambiar={(v) =>
                      setPestanas((todas) => todas.map((x) => (x.ruta === p.ruta && x.tipo === "texto" ? { ...x, actual: v } : x)))
                    }
                    alGuardar={() => void guardarPestana(p.ruta)}
                  />
                ) : null}
                {p.tipo === "binario" || p.tipo === "grande" ? (
                  <div className="space-y-3 p-6 text-sm text-dex-muted">
                    <p>
                      <b className="text-dex-ink">{nombreDe(p.ruta)}</b> ({tamanoLegible(p.bytes)}, permisos {p.modo}){" "}
                      {p.tipo === "binario" ? "es binario y no se edita como texto." : "pasa de 5 MB: ábrelo desde la terminal (less, nano, vim)."}
                    </p>
                    <div className="flex gap-2">
                      <a className={CLASE_BOTON.secundario} href={urlDeDescarga(p.ruta)}>Descargar</a>
                      <button type="button" className={CLASE_BOTON.secundario} onClick={() => terminalEn(padre(p.ruta))}>
                        Terminal en su carpeta
                      </button>
                    </div>
                  </div>
                ) : null}
                {p.tipo === "plugin" ? (
                  <FichaPlugin
                    plugin={pluginDe(p.ruta)}
                    ruta={p.ruta}
                    alAlternar={() => void alternarPlugin(p.ruta)}
                    alAbrirCarpeta={(nombre) => revelar(`plugins/${nombre}`)}
                    alError={avisarError}
                  />
                ) : null}
              </div>
            ))}
          </div>

          {terminalVisible ? (
            <>
              <div onPointerDown={arrastrarDivisor("y")} className="h-1 shrink-0 cursor-row-resize border-t border-dex-line hover:bg-dex-accent/40" />
              <div style={{ height: altoTerminal }} className="shrink-0">
                <PanelTerminal pedido={pedidoTerminal} alError={avisarError} />
              </div>
            </>
          ) : null}
        </section>
      </div>

      {/* Barra de estado */}
      <div className="flex items-center gap-4 border-t border-dex-line bg-dex-panel/70 px-3 py-1 text-[11px] text-dex-muted">
        {seleccion !== null && entradaSeleccionada ? (
          <>
            <span className="truncate text-dex-ink">/{seleccion}</span>
            <span>{entradaSeleccionada.modo}</span>
            {!esCarpeta(entradaSeleccionada) ? <span>{tamanoLegible(entradaSeleccionada.bytes)}</span> : null}
            <span>{new Date(entradaSeleccionada.modificado).toLocaleString("es-CL")}</span>
          </>
        ) : (
          <span>Nada seleccionado</span>
        )}
        {pestanaActiva?.tipo === "texto" ? <span className="ml-auto">{lenguajeDe(pestanaActiva.ruta)} · UTF-8 · LF</span> : null}
        {aviso ? (
          <span
            role={aviso.tono === "mal" ? "alert" : "status"}
            className={`${pestanaActiva?.tipo === "texto" ? "" : "ml-auto"} flex items-center gap-2 ${
              aviso.tono === "mal" ? "text-red-400" : aviso.tono === "bien" ? "text-emerald-400" : "text-dex-ink"
            }`}
          >
            {aviso.texto}
            <button type="button" aria-label="Cerrar aviso" onClick={() => setAviso(null)} className="opacity-70 hover:opacity-100">
              ×
            </button>
          </span>
        ) : null}
      </div>

      {/* Menú contextual */}
      {menu ? (
        <ul
          role="menu"
          style={{ left: Math.min(menu.x, window.innerWidth - 270), top: Math.min(menu.y, window.innerHeight - 20 - opcionesDe(menu).length * 26) }}
          className="fixed z-[60] w-64 rounded-lg border border-dex-line bg-dex-panel py-1 text-xs text-dex-ink shadow-2xl"
        >
          {opcionesDe(menu).map((o, i) =>
            o === "—" ? (
              <li key={`sep-${i}`} role="separator" className="my-1 border-t border-dex-line/60" />
            ) : (
              <li key={o.texto} role="none">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(null);
                    o.hacer();
                  }}
                  className={`flex w-full items-center px-3 py-1.5 text-left hover:bg-dex-accent/15 ${o.peligro ? "text-red-400" : ""}`}
                >
                  {o.texto}
                  {o.atajo ? <span className="ml-auto text-dex-muted">{o.atajo}</span> : null}
                </button>
              </li>
            ),
          )}
        </ul>
      ) : null}

      {/* Diálogos */}
      {dialogo?.tipo === "nombre" ? (
        <DialogoNombre
          titulo={dialogo.titulo}
          valor={dialogo.valor}
          alCancelar={() => setDialogo(null)}
          alAceptar={async (v) => {
            try {
              await dialogo.aceptar(v);
              setDialogo(null);
            } catch (e) {
              avisarError(e);
            }
          }}
        />
      ) : null}
      {dialogo?.tipo === "permisos" ? (
        <DialogoPermisos
          ruta={dialogo.ruta}
          modo={dialogo.modo}
          esCarpeta={dialogo.esCarpeta}
          alCancelar={() => setDialogo(null)}
          alAceptar={async (modo, recursivo) => {
            try {
              await accion({ accion: "permisos", ruta: dialogo.ruta, modo, recursivo });
              avisar(`Permisos de ${dialogo.ruta}: ${modo}${recursivo ? " (recursivo)" : ""}`, "bien");
              setDialogo(null);
              await refrescar(padre(dialogo.ruta), dialogo.ruta);
            } catch (e) {
              avisarError(e);
            }
          }}
        />
      ) : null}

      {/* Entradas ocultas para subir */}
      <input
        ref={entradaSubida}
        type="file"
        multiple
        hidden
        onChange={(ev) => {
          const lista = [...(ev.target.files ?? [])].map((archivo) => ({ relativa: archivo.name, archivo }));
          ev.target.value = "";
          void subirVarios(destinoSubida.current, lista);
        }}
      />
      <input
        ref={entradaCarpeta}
        type="file"
        hidden
        // @ts-expect-error: atributo no estándar pero soportado por todos los navegadores actuales
        webkitdirectory=""
        onChange={(ev) => {
          const lista = [...(ev.target.files ?? [])].map((archivo) => ({
            relativa: archivo.webkitRelativePath || archivo.name,
            archivo,
          }));
          ev.target.value = "";
          void subirVarios(destinoSubida.current, lista);
        }}
      />
      <input
        ref={entradaZip}
        type="file"
        accept=".zip,.tar,.tar.gz,.tgz,.tar.xz,.tar.bz2"
        hidden
        onChange={(ev) => {
          const archivo = ev.target.files?.[0];
          ev.target.value = "";
          if (archivo) {void instalarZip(destinoSubida.current, archivo);}
        }}
      />
      <AtajoTerminal alAlternar={() => setTerminalVisible((v) => !v)} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Piezas                                                              */
/* ------------------------------------------------------------------ */

function AtajoTerminal({ alAlternar }: { alAlternar: () => void }) {
  const ref = useRef(alAlternar);
  ref.current = alAlternar;
  useEffect(() => {
    const tecla = (ev: KeyboardEvent) => {
      if (ev.ctrlKey && ev.key === "`") {
        ev.preventDefault();
        ref.current();
      }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, []);
  return null;
}

function Bienvenida() {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center text-sm text-dex-muted">
      <div className="max-w-md space-y-2">
        <p className="text-base text-dex-ink">Abre un archivo del explorador</p>
        <p>
          Toda la carpeta del servidor: plugins, mundos, registros, configuración. Clic derecho sobre una carpeta para subir,
          instalar un .zip, cambiar permisos o abrir una terminal ahí.
        </p>
        <p className="text-xs">Los cambios de plugins y de server.properties se aplican al reiniciar el servidor.</p>
      </div>
    </div>
  );
}

function FichaPlugin({
  plugin,
  ruta,
  alAlternar,
  alAbrirCarpeta,
  alError,
}: {
  plugin: Plugin | undefined;
  ruta: string;
  alAlternar: () => void;
  alAbrirCarpeta: (nombre: string) => void;
  alError: (e: unknown) => void;
}) {
  const [registro, setRegistro] = useState<string[] | null>(null);
  if (!plugin) {
    return (
      <div className="space-y-3 p-6 text-sm text-dex-muted">
        <p>{nombreDe(ruta)}: no se pudieron leer sus datos de plugin.</p>
        <a className={CLASE_BOTON.secundario} href={urlDeDescarga(ruta)}>Descargar</a>
      </div>
    );
  }
  return (
    <div className="h-full space-y-4 overflow-auto p-6 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-xl text-dex-ink">{plugin.nombre}</h3>
        {plugin.version ? <span className="text-dex-muted">v{plugin.version}</span> : null}
        <span className="inline-flex items-center gap-2 rounded-full border border-dex-line px-3 py-1 text-xs text-dex-ink">
          <span className={`h-2 w-2 rounded-full ${COLOR_PLUGIN[plugin.estado]}`} />
          {TEXTO_PLUGIN[plugin.estado]}
        </span>
      </div>
      {plugin.descripcion ? <p className="text-dex-muted">{plugin.descripcion}</p> : null}
      <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-xs">
        <dt className="text-dex-muted">Archivo</dt>
        <dd className="font-[ui-monospace,monospace] text-dex-ink">plugins/{plugin.archivo}</dd>
        <dt className="text-dex-muted">Tamaño</dt>
        <dd className="text-dex-ink">{tamanoLegible(plugin.bytes)}</dd>
        {plugin.autores.length ? (
          <>
            <dt className="text-dex-muted">Autores</dt>
            <dd className="text-dex-ink">{plugin.autores.join(", ")}</dd>
          </>
        ) : null}
        <dt className="text-dex-muted">Cargado ahora</dt>
        <dd className="text-dex-ink">{plugin.cargado === null ? "no se sabe (RCON no contesta)" : plugin.cargado ? "sí" : "no"}</dd>
      </dl>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={plugin.protegido}
          title={plugin.protegido ? "Los plugins de VTuberDex no se apagan desde la web" : undefined}
          className={plugin.habilitado ? CLASE_BOTON.peligro : CLASE_BOTON.primario}
          onClick={alAlternar}
        >
          {plugin.habilitado ? "Desactivar" : "Activar"}
        </button>
        <button type="button" className={CLASE_BOTON.secundario} onClick={() => alAbrirCarpeta(plugin.nombre)}>
          Abrir su carpeta de configuración
        </button>
        <button
          type="button"
          className={CLASE_BOTON.secundario}
          onClick={() => registroDePlugin(plugin.nombre).then(setRegistro, alError)}
        >
          Ver registro
        </button>
        <a className={CLASE_BOTON.secundario} href={urlDeDescarga(ruta)}>
          Descargar jar
        </a>
      </div>
      <p className="text-xs text-dex-muted">
        Activar o desactivar renombra el jar (<code>.jar</code> ↔ <code>.jar.disabled</code>) y se aplica al reiniciar. Para
        reemplazarlo por una versión nueva, arrastra el jar nuevo sobre la carpeta <code>plugins</code>.
      </p>
      {registro ? (
        <pre className="max-h-96 overflow-auto rounded-lg border border-dex-line bg-black/40 p-3 font-[ui-monospace,monospace] text-[11px] leading-relaxed text-dex-ink">
          {registro.length ? registro.join("\n") : "Sin líneas de este plugin en logs/latest.log."}
        </pre>
      ) : null}
    </div>
  );
}

function Modal({ titulo, children, alCerrar }: { titulo: string; children: ReactNode; alCerrar: () => void }) {
  useEffect(() => {
    const tecla = (ev: KeyboardEvent) => ev.key === "Escape" && alCerrar();
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [alCerrar]);
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[15vh]">
      {/* El fondo es un botón: clic fuera cierra, y Escape también (arriba). */}
      <button type="button" aria-label="Cerrar diálogo" tabIndex={-1} className="absolute inset-0 cursor-default bg-black/50" onClick={alCerrar} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className="relative w-[min(32rem,92vw)] space-y-3 rounded-xl border border-dex-line bg-dex-panel p-4 shadow-2xl"
      >
        <h3 className="text-sm font-bold text-dex-ink">{titulo}</h3>
        {children}
      </div>
    </div>
  );
}

function DialogoNombre({
  titulo,
  valor,
  alAceptar,
  alCancelar,
}: {
  titulo: string;
  valor: string;
  alAceptar: (v: string) => Promise<void>;
  alCancelar: () => void;
}) {
  const [texto, setTexto] = useState(valor);
  const [ocupado, setOcupado] = useState(false);
  return (
    <Modal titulo={titulo} alCerrar={alCancelar}>
      <form
        className="space-y-3"
        onSubmit={async (ev) => {
          ev.preventDefault();
          if (!texto.trim()) {return;}
          setOcupado(true);
          await alAceptar(texto.trim());
          setOcupado(false);
        }}
      >
        <input
           
          autoFocus
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onFocus={(e) => {
            const punto = e.target.value.lastIndexOf(".");
            e.target.setSelectionRange(0, punto > 0 ? punto : e.target.value.length);
          }}
          aria-label={titulo}
          className={CLASE_CAMPO_MONO}
        />
        <div className="flex justify-end gap-2">
          <button type="button" className={CLASE_BOTON.fantasma} onClick={alCancelar}>
            Cancelar
          </button>
          <button type="submit" disabled={ocupado} className={CLASE_BOTON.primario}>
            Aceptar
          </button>
        </div>
      </form>
    </Modal>
  );
}

const QUIENES = [
  ["Dueño", 6],
  ["Grupo", 3],
  ["Otros", 0],
] as const;
const BITS = [
  ["Leer", 4],
  ["Escribir", 2],
  ["Ejecutar", 1],
] as const;

function DialogoPermisos({
  ruta,
  modo,
  esCarpeta: carpeta,
  alAceptar,
  alCancelar,
}: {
  ruta: string;
  modo: string;
  esCarpeta: boolean;
  alAceptar: (modo: string, recursivo: boolean) => Promise<void>;
  alCancelar: () => void;
}) {
  const [valor, setValor] = useState(() => Number.parseInt(modo, 8) & 0o777);
  const [recursivo, setRecursivo] = useState(false);
  const octal = valor.toString(8).padStart(3, "0");
  return (
    <Modal titulo={`Permisos de /${ruta}`} alCerrar={alCancelar}>
      <table className="w-full text-xs text-dex-ink">
        <thead>
          <tr className="text-dex-muted">
            <th />
            {BITS.map(([n]) => (
              <th key={n} className="py-1 font-normal">{n}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {QUIENES.map(([quien, desplazamiento]) => (
            <tr key={quien}>
              <td className="py-1 text-dex-muted">{quien}</td>
              {BITS.map(([n, bit]) => {
                const mascara = bit << desplazamiento;
                return (
                  <td key={n} className="text-center">
                    <input
                      type="checkbox"
                      aria-label={`${quien}: ${n}`}
                      checked={(valor & mascara) !== 0}
                      onChange={(e) => setValor((v) => (e.target.checked ? v | mascara : v & ~mascara))}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <label className="flex items-center gap-2 text-xs text-dex-ink">
        Octal
        <input
          value={octal}
          onChange={(e) => /^[0-7]{0,3}$/.test(e.target.value) && setValor(Number.parseInt(e.target.value || "0", 8))}
          className={`${CLASE_CAMPO_MONO} w-20`}
          aria-label="Permisos en octal"
        />
      </label>
      {carpeta ? (
        <label className="flex items-center gap-2 text-xs text-dex-ink">
          <input type="checkbox" checked={recursivo} onChange={(e) => setRecursivo(e.target.checked)} />
          Aplicar a todo lo que hay dentro
        </label>
      ) : null}
      <p className="text-[11px] text-dex-muted">
        El servidor corre como el usuario <code>minecraft</code>: el dueño necesita al menos leer (y escribir si el plugin guarda datos).
      </p>
      <div className="flex justify-end gap-2">
        <button type="button" className={CLASE_BOTON.fantasma} onClick={alCancelar}>
          Cancelar
        </button>
        <button type="button" className={CLASE_BOTON.primario} onClick={() => void alAceptar(octal, recursivo)}>
          Aplicar {octal}
        </button>
      </div>
    </Modal>
  );
}
