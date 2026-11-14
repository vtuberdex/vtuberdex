// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
"use client";
/**
 * El DETALLE de una solicitud de la cola del mantenedor (`solicitudes-manager.tsx`): veredicto de la vista
 * previa, acciones y el contenido agrupado por secciones según el tipo.
 *
 * Vive aparte porque el manager llegó a 1.300 líneas con la lista, los filtros y todo el detalle en un solo
 * JSX; cada sección de aquí recibe la solicitud y decide una sola cosa. El estado (selección, nota, vista
 * previa, resolver) sigue en el manager.
 */
import { useEffect, useState, type ReactNode } from "react";

import { conClaves } from "@/components/admin/claves";
import { DatoOculto, QuizasCorreo } from "@/components/admin/dato-oculto";
import { SocialIcon } from "@/components/social-icon";
import {
  api,
  type FichaResumen,
  type SolicitudAdmin,
  type VistaPreviaSolicitud,
} from "@/lib/api";
import { haceCuanto } from "@/lib/tiempo-relativo";
import { ghostButton, inputClass, primaryButton } from "@/components/admin/ui";

export type Accion = "aprobar" | "rechazar" | "procesar";

export const META: Record<
  SolicitudAdmin["tipo"],
  { etiqueta: string; clase: string; aprobar: string }
> = {
  inscripcion: {
    etiqueta: "Inscripción",
    clase: "bg-dex-accent/20 text-dex-accent",
    aprobar: "Aprobar y crear borrador",
  },
  modificacion: {
    etiqueta: "Modificación",
    clase: "bg-violet-400/20 text-violet-200",
    aprobar: "Aprobar y aplicar cambios",
  },
  baja: {
    etiqueta: "Baja",
    clase: "bg-amber-300/20 text-amber-200",
    aprobar: "Marcar procesada",
  },
};

export const ESTADO_CLASE: Record<SolicitudAdmin["estado"], string> = {
  pendiente: "text-amber-200",
  aprobada: "text-emerald-300",
  procesada: "text-emerald-300",
  rechazada: "text-rose-300",
};

export const texto = (valor: unknown) =>
  typeof valor === "string" ? valor : "";

/** El nombre con que se reconoce una solicitud de un vistazo. */
export function tituloDe(s: SolicitudAdmin): string {
  return (
    (s.tipo === "inscripcion" ? texto(s.datos.name) : texto(s.datos.ficha)) ||
    `Solicitud #${s.id}`
  );
}

/** Qué hará aprobar una modificación: cuántos cambios aplica a la ficha, o que no hay nada que cambiar. */
function fraseDeModificacion(
  cambios: VistaPreviaSolicitud["cambios"],
  nombre: string,
): string {
  const n = cambios?.length ?? 0;
  if (n === 0) {
    return `No hay nada que cambiar en «${nombre}».`;
  }
  const palabra = n === 1 ? "cambio" : "cambios";
  return `Aplicará ${n} ${palabra} a «${nombre}».`;
}

function VeredictoProblema({
  problema,
}: Readonly<{ problema: NonNullable<VistaPreviaSolicitud["problema"]> }>) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100"
    >
      <strong>No se puede aprobar todavía.</strong> {problema.mensaje}
      {problema.detalles && (
        <ul className="mt-1 list-disc pl-5 text-xs">
          {conClaves(problema.detalles, (d) => `${d.path}|${d.message}`).map(
            ({ item: d, clave }) => (
              <li key={clave}>
                {d.path}: {d.message}
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

function VeredictoListo({ vista }: Readonly<{ vista: VistaPreviaSolicitud }>) {
  const modificacion = vista.tipo === "modificacion" ? vista.ficha : null;
  return (
    <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
      {vista.creara && (
        <>
          <strong>Lista para aprobar.</strong> Creará la ficha «
          {vista.creara.name}» en <strong>borrador</strong>, en{" "}
          <span className="font-mono">/v/{vista.creara.slug}</span>.
        </>
      )}
      {modificacion && (
        <>
          <strong>Lista para aprobar.</strong>{" "}
          {fraseDeModificacion(vista.cambios, modificacion.name)}
        </>
      )}
      {vista.tipo === "baja" && (
        <>
          <strong>Lista para cerrar.</strong> Cerrar la solicitud no toca la
          ficha.
        </>
      )}
    </div>
  );
}

export function Veredicto({
  vista,
  cargando,
  solicitud,
}: Readonly<{
  vista: VistaPreviaSolicitud | null;
  cargando: boolean;
  solicitud: SolicitudAdmin;
}>) {
  if (solicitud.estado !== "pendiente") {
    return null;
  }
  if (cargando && !vista) {
    return (
      <p className="rounded-xl border border-dex-line px-3 py-2 text-xs text-dex-muted">
        Comprobando si se puede aprobar…
      </p>
    );
  }
  if (!vista) {
    return null;
  }
  return (
    <div className="space-y-2" data-testid="solicitud-veredicto">
      {vista.problema ? (
        <VeredictoProblema problema={vista.problema} />
      ) : (
        <VeredictoListo vista={vista} />
      )}
      {vista.avisos.map((aviso) => (
        <p
          key={aviso}
          className="rounded-xl border border-amber-300/30 bg-amber-300/5 px-3 py-2 text-xs text-amber-100"
        >
          {aviso}
        </p>
      ))}
    </div>
  );
}

/** Cuando lo escrito en el formulario no se resuelve solo: se ELIGE la ficha (candidatas o búsqueda). */
export function ElegirFicha({
  token,
  candidatas,
  elegida,
  onElegir,
}: Readonly<{
  token: string;
  candidatas: FichaResumen[];
  elegida: string | null;
  onElegir: (slug: string | null) => void;
}>) {
  const [consulta, setConsulta] = useState("");
  const [resultados, setResultados] = useState<FichaResumen[]>([]);
  useEffect(() => {
    const q = consulta.trim();
    if (q.length < 2) {
      setResultados([]);
      return undefined;
    }
    const controller = new AbortController();
    api
      .adminList(token, { q, perPage: 6 }, controller.signal)
      .then((r) =>
        setResultados(
          r.items.map((i) => ({
            id: i.id,
            slug: i.slug,
            name: i.name,
            dexNumber: i.dexNumber,
            status: i.status,
            grado: i.premium?.grade ?? null,
          })),
        ),
      )
      .catch(() => undefined);
    return () => controller.abort();
  }, [token, consulta]);

  const opciones = consulta.trim().length >= 2 ? resultados : candidatas;
  return (
    <section
      className="space-y-2 rounded-xl border border-dex-line bg-dex-void/50 p-3"
      data-testid="solicitud-elegir-ficha"
    >
      <h4 className="text-xs font-bold uppercase tracking-[0.14em] text-dex-muted">
        ¿De qué ficha se trata?
      </h4>
      <input
        className={`${inputClass} mt-0`}
        placeholder="Busca por nombre o número…"
        aria-label="Buscar la ficha de esta solicitud"
        value={consulta}
        onChange={(e) => setConsulta(e.target.value)}
      />
      <ul className="space-y-1">
        {opciones.map((f) => (
          <li key={f.slug} className="flex items-center gap-2 text-sm">
            <span className="font-mono text-[11px] text-dex-muted">
              #{String(f.dexNumber).padStart(3, "0")}
            </span>
            <span className="min-w-0 flex-1 truncate text-dex-ink">
              {f.name}
            </span>
            <button
              type="button"
              className={elegida === f.slug ? primaryButton : ghostButton}
              aria-pressed={elegida === f.slug}
              onClick={() => onElegir(elegida === f.slug ? null : f.slug)}
            >
              {elegida === f.slug ? "Elegida ✓" : "Es esta"}
            </button>
          </li>
        ))}
        {opciones.length === 0 && (
          <li className="text-xs text-dex-muted">
            {consulta.trim().length >= 2
              ? "Ninguna ficha coincide."
              : "Escribe para buscar la ficha."}
          </li>
        )}
      </ul>
    </section>
  );
}

const etiquetaDeImagen = (tipo: string) =>
  tipo === "character" ? "Avatar" : "Logo";

interface ImagenSubida {
  tipo: string;
  ancho: number;
  alto: number;
  size: number;
  url: string;
}

/** Cargando, las imágenes subidas, o por qué no hay ninguna (enlaces antiguos o caducadas). */
function EstadoDeImagenes({
  cargando,
  imagenes,
  antiguas,
}: Readonly<{
  cargando: boolean;
  imagenes: ImagenSubida[];
  antiguas: boolean;
}>) {
  if (cargando) {
    return <p className="text-xs text-dex-muted">Cargando imágenes…</p>;
  }
  if (imagenes.length === 0) {
    return (
      <p className="text-xs text-dex-muted">
        {antiguas
          ? "Esta solicitud llegó con enlaces (formulario anterior): descarga y sube las imágenes desde «Imágenes»."
          : "No hay imágenes guardadas: pudieron caducar (30 días sin aprobar) o ya se aplicaron."}
      </p>
    );
  }
  return (
    <ul className="flex flex-wrap gap-4">
      {imagenes.map((i) => (
        <li key={i.tipo} className="space-y-1 text-xs text-dex-muted">
          <div
            className="flex items-center justify-center overflow-hidden rounded-md border border-dex-line"
            style={{
              width: i.tipo === "character" ? 140 : 180,
              height: i.tipo === "character" ? 196 : 140,
              backgroundImage:
                "conic-gradient(#2a3140 25%, #1b212d 0 50%, #2a3140 0 75%, #1b212d 0)",
              backgroundSize: "12px 12px",
            }}
          >
            <img
              src={i.url}
              alt={etiquetaDeImagen(i.tipo)}
              className="h-full w-full object-contain"
            />
          </div>
          <p>
            <span className="font-bold text-dex-ink">
              {etiquetaDeImagen(i.tipo)}
            </span>{" "}
            · {i.ancho}×{i.alto} · {Math.round(i.size / 1024)} KB
          </p>
        </li>
      ))}
    </ul>
  );
}

/**
 * Las imágenes que la persona SUBIÓ con el formulario (avatar y logo), para verlas antes de aprobar. Al
 * aprobar pasan solas a la ficha; si la solicitud es antigua (enlaces) o las imágenes ya caducaron
 * (`LIMITES.vidaPendienteMs`: 30 días sin aprobar) lo dice.
 */
export function ImagenesSubidas({
  token,
  solicitud,
}: Readonly<{
  token: string;
  solicitud: SolicitudAdmin;
}>) {
  const [imagenes, setImagenes] = useState<ImagenSubida[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vigente = true;
    const urls: string[] = [];
    setCargando(true);
    void (async () => {
      try {
        const { imagenes: lista } = await api.imagenesDeSolicitud(
          token,
          solicitud.id,
        );
        const listas = await Promise.all(
          lista.map(async (i) => {
            const blob = await api.imagenSubidaDeSolicitud(
              token,
              solicitud.id,
              i.tipo,
            );
            if (!blob) {
              return null;
            }
            const url = URL.createObjectURL(blob);
            urls.push(url);
            return { ...i, url };
          }),
        );
        if (vigente) {
          setImagenes(
            listas.filter((i): i is NonNullable<typeof i> => i !== null),
          );
        }
      } catch {
        if (vigente) {
          setImagenes([]);
        }
      } finally {
        if (vigente) {
          setCargando(false);
        }
      }
    })();
    return () => {
      vigente = false;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [token, solicitud.id]);

  const antiguas =
    texto(solicitud.datos.imageUrl) || texto(solicitud.datos.logoUrl);

  return (
    <div data-testid="solicitud-imagenes">
      <EstadoDeImagenes
        cargando={cargando}
        imagenes={imagenes}
        antiguas={Boolean(antiguas)}
      />
      {antiguas && (
        <dl className="mt-3 grid gap-2">
          <Dato
            k="Avatar (enlace)"
            v={texto(solicitud.datos.imageUrl)}
            ancho
            enlace
          />
          <Dato
            k="Logo (enlace)"
            v={texto(solicitud.datos.logoUrl)}
            ancho
            enlace
          />
        </dl>
      )}
      {!antiguas && imagenes.length > 0 && (
        <p className="mt-2 text-xs text-dex-muted">
          Al aprobar pasan solas a la ficha{" "}
          {solicitud.tipo === "modificacion"
            ? "y REEMPLAZAN a las actuales"
            : "(la ficha nace en borrador)"}
          . Si rechazas, se borran.
        </p>
      )}
    </div>
  );
}

export function Seccion({
  titulo,
  children,
  abierta = true,
}: Readonly<{
  titulo: string;
  children: ReactNode;
  abierta?: boolean;
}>) {
  return (
    <details
      open={abierta}
      className="group rounded-xl border border-dex-line bg-dex-panel/40"
    >
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] text-dex-muted">
        {titulo}
      </summary>
      <div className="border-t border-dex-line/60 px-3 py-3">{children}</div>
    </details>
  );
}

export function Dato({
  k,
  v,
  ancho = false,
  enlace = false,
}: Readonly<{
  k: string;
  v: string;
  ancho?: boolean;
  enlace?: boolean;
}>) {
  if (!v) {
    return null;
  }
  const esUrl = enlace && /^https?:\/\//i.test(v);
  return (
    <div className={ancho ? "sm:col-span-2" : ""}>
      <dt className="text-[11px] uppercase tracking-[0.12em] text-dex-muted">
        {k}
      </dt>
      <dd className="break-words text-sm text-dex-ink">
        {esUrl ? (
          <a
            href={v}
            target="_blank"
            rel="noopener noreferrer"
            className="text-dex-accent underline underline-offset-2"
          >
            {v}
          </a>
        ) : (
          v
        )}
      </dd>
    </div>
  );
}

/** Los campos de perfil de una inscripción (o todo lo enviado en una modificación), en una rejilla. */
export function CamposDeFicha({ s }: Readonly<{ s: SolicitudAdmin }>) {
  const d = s.datos;
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      <Dato k="Signo" v={texto(d.zodiac)} />
      <Dato k="Estatura" v={texto(d.height)} />
      <Dato k="Cumpleaños" v={texto(d.birthday)} />
      <Dato k="Color favorito" v={texto(d.favoriteColor)} />
      <Dato k="Comida favorita" v={texto(d.favoriteFood)} />
      <Dato k="Comida que desagrada" v={texto(d.dislikedFood)} />
      <Dato k="Videojuego" v={texto(d.favoriteGame)} />
      <Dato k="Serie" v={texto(d.favoriteSeries)} />
      <Dato k="Música" v={texto(d.favoriteMusic)} />
      <Dato k="Anime" v={texto(d.favoriteAnime)} />
      <Dato k="Animal" v={texto(d.favoriteAnimal)} />
      <Dato k="Modelo (autoría)" v={texto(d.modeler)} />
      <Dato k="Hashtag de arte" v={texto(d.hashtag)} />
    </dl>
  );
}

export function Redes({ s }: Readonly<{ s: SolicitudAdmin }>) {
  const redes = Array.isArray(s.datos.socials)
    ? (s.datos.socials as Array<{ platform: string; url: string }>)
    : [];
  if (!redes.length) {
    return null;
  }
  return (
    <ul className="flex flex-wrap gap-2">
      {conClaves(redes, (r) => `${r.platform}|${r.url}`).map(
        ({ item: r, clave }) => (
          <li key={clave}>
            <a
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-full border border-dex-line px-3 py-1 text-xs text-dex-accent hover:bg-dex-accent/10"
            >
              <SocialIcon platform={r.platform} url={r.url} /> {r.platform}{" "}
              <span aria-hidden>↗</span>
            </a>
          </li>
        ),
      )}
    </ul>
  );
}
/** Una modificación trae imágenes si subió alguna o, en el formulario antiguo, si mandó enlaces. */
function traeImagenes(s: SolicitudAdmin): boolean {
  const d = s.datos;
  return [d.imageId, d.logoId, d.imageUrl, d.logoUrl].some((v) => texto(v));
}

/** «Qué cambia en «Ficha»» con la vista previa; sin ella, lo pedido tal cual. */
function tituloDeCambios(vista: VistaPreviaSolicitud | null): string {
  if (!vista?.cambios) {
    return "Cambios pedidos";
  }
  const enFicha = vista.ficha ? ` en «${vista.ficha.name}»` : "";
  return `Qué cambia${enFicha}`;
}

const idiomasDe = (s: SolicitudAdmin) =>
  Array.isArray(s.datos.languages)
    ? (s.datos.languages as string[]).join(", ")
    : "";

function EnlaceDeFicha({ slug }: Readonly<{ slug: string }>) {
  return (
    <a
      href={`/v/${slug}`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-dex-accent underline underline-offset-2"
    >
      /v/{slug}
    </a>
  );
}

function CabeceraDelDetalle({ s }: Readonly<{ s: SolicitudAdmin }>) {
  return (
    <header className="space-y-1">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span
          className={`rounded px-2 py-0.5 font-bold uppercase ${META[s.tipo].clase}`}
        >
          {META[s.tipo].etiqueta}
        </span>
        <span className="font-mono text-dex-muted">#{s.id}</span>
        <span className={`font-semibold ${ESTADO_CLASE[s.estado]}`}>
          {s.estado}
        </span>
        <span
          className="ml-auto text-dex-muted"
          title="Versión de los términos aceptada"
        >
          términos {s.terminosVersion}
        </span>
      </div>
      <h3 className="text-xl font-bold text-dex-ink">{tituloDe(s)}</h3>
      <p className="text-xs text-dex-muted">
        Recibida {haceCuanto(s.creado)} ·{" "}
        {new Date(s.creado).toLocaleString("es-CL")}
      </p>
    </header>
  );
}

function AccionesDeSolicitud({
  s,
  vista,
  cargandoVista,
  ocupada,
  nota,
  onNota,
  rechazando,
  onRechazando,
  onResolver,
}: Readonly<{
  s: SolicitudAdmin;
  vista: VistaPreviaSolicitud | null;
  cargandoVista: boolean;
  ocupada: number | null;
  nota: string;
  onNota: (nota: string) => void;
  rechazando: boolean;
  onRechazando: (rechazando: boolean) => void;
  onResolver: (s: SolicitudAdmin, accion: Accion) => void;
}>) {
  const ocupadaEsta = ocupada === s.id;
  // Sin vista previa (servidor antiguo) el botón queda habilitado; con ella, solo si la regla lo permite.
  const bloqueada = cargandoVista || (vista !== null && !vista.puedeAprobar);
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-xl border border-dex-line bg-dex-void/50 p-3"
      data-testid="solicitud-acciones"
    >
      <input
        className={`${inputClass} mt-0 w-full sm:max-w-xs sm:flex-1`}
        placeholder="Nota interna (opcional)"
        aria-label={`Nota de la solicitud ${s.id}`}
        value={nota}
        onChange={(e) => onNota(e.target.value)}
      />
      <button
        type="button"
        className={primaryButton}
        disabled={ocupadaEsta || bloqueada}
        onClick={() =>
          onResolver(s, s.tipo === "baja" ? "procesar" : "aprobar")
        }
      >
        {META[s.tipo].aprobar}
      </button>
      {rechazando ? (
        <span
          className="flex flex-wrap items-center gap-2 text-xs text-dex-muted"
          data-testid="solicitud-confirmar-rechazo"
        >
          ¿Rechazar? Se borrará el contacto y no se puede deshacer.{" "}
          <button
            type="button"
            className={ghostButton}
            disabled={ocupadaEsta}
            onClick={() => onResolver(s, "rechazar")}
          >
            Sí, rechazar
          </button>
          <button
            type="button"
            className={ghostButton}
            onClick={() => onRechazando(false)}
          >
            No
          </button>
        </span>
      ) : (
        <button
          type="button"
          className={ghostButton}
          disabled={ocupadaEsta}
          onClick={() => onRechazando(true)}
        >
          Rechazar
        </button>
      )}
    </div>
  );
}

function ContenidoDeInscripcion({
  token,
  s,
}: Readonly<{ token: string; s: SolicitudAdmin }>) {
  const color = texto(s.datos.themeColor);
  return (
    <>
      <Seccion titulo="La ficha propuesta">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <Dato k="Nombre" v={texto(s.datos.name)} />
          <Dato k="País" v={texto(s.datos.country)} />
          <Dato k="Idiomas" v={idiomasDe(s)} />
          <div>
            <dt className="text-[11px] uppercase tracking-[0.12em] text-dex-muted">
              Color
            </dt>
            <dd className="flex items-center gap-2 text-sm text-dex-ink">
              {/^#[0-9a-f]{3,8}$/i.test(color) && (
                <span
                  aria-hidden
                  className="h-4 w-4 rounded border border-white/20"
                  style={{ background: color }}
                />
              )}
              {color}
            </dd>
          </div>
          <Dato k="Frase" v={texto(s.datos.phrase)} ancho />
        </dl>
      </Seccion>
      <Seccion titulo="Historia (lore)">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-dex-ink">
          {texto(s.datos.cardText)}
        </p>
      </Seccion>
      <Seccion titulo="Perfil y gustos" abierta={false}>
        <CamposDeFicha s={s} />
      </Seccion>
      <Seccion titulo="Redes y canales">
        <Redes s={s} />
      </Seccion>
      <Seccion titulo="Imágenes subidas">
        <ImagenesSubidas token={token} solicitud={s} />
      </Seccion>
    </>
  );
}

function TablaDeCambios({
  cambios,
}: Readonly<{ cambios: NonNullable<VistaPreviaSolicitud["cambios"]> }>) {
  return (
    <div className="overflow-x-auto">
      <table
        className="w-full text-left text-sm"
        data-testid="solicitud-cambios"
      >
        <thead className="text-[11px] uppercase tracking-[0.12em] text-dex-muted">
          <tr>
            <th className="py-1 pr-3 font-semibold">Campo</th>
            <th className="py-1 pr-3 font-semibold">Ahora</th>
            <th className="py-1 font-semibold">Propuesto</th>
          </tr>
        </thead>
        <tbody>
          {cambios.map((c) => (
            <tr key={c.campo} className="border-t border-dex-line/50 align-top">
              <td className="py-1.5 pr-3 text-dex-muted">{c.campo}</td>
              <td className="max-w-[18rem] break-words py-1.5 pr-3 text-rose-200/80">
                {c.nuevo ? (
                  <em className="text-dex-muted">(vacío)</em>
                ) : (
                  c.antes
                )}
              </td>
              <td className="max-w-[22rem] break-words py-1.5 text-emerald-200">
                {c.despues}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Con vista previa, la tabla antes → después (o que nada cambia); sin ella, los campos tal como llegaron. */
function CambiosDeModificacion({
  vista,
  s,
}: Readonly<{ vista: VistaPreviaSolicitud | null; s: SolicitudAdmin }>) {
  if (!vista?.cambios) {
    return <CamposDeFicha s={s} />;
  }
  if (vista.cambios.length === 0) {
    return <p className="text-sm text-dex-muted">Ningún valor cambia.</p>;
  }
  return <TablaDeCambios cambios={vista.cambios} />;
}

function ContenidoDeModificacion({
  token,
  s,
  vista,
}: Readonly<{
  token: string;
  s: SolicitudAdmin;
  vista: VistaPreviaSolicitud | null;
}>) {
  return (
    <>
      {traeImagenes(s) && (
        <Seccion titulo="Imágenes subidas">
          <ImagenesSubidas token={token} solicitud={s} />
        </Seccion>
      )}
      <Seccion titulo={tituloDeCambios(vista)}>
        <CambiosDeModificacion vista={vista} s={s} />
        {vista?.ficha && (
          <p className="mt-3 text-xs text-dex-muted">
            Ficha:{" "}
            <span className="font-mono text-dex-ink">
              #{String(vista.ficha.dexNumber).padStart(3, "0")}
            </span>{" "}
            {vista.ficha.name} · <EnlaceDeFicha slug={vista.ficha.slug} />
          </p>
        )}
      </Seccion>
      <Seccion titulo="Quién la pide">
        <dl className="grid gap-2">
          <Dato k="Ficha que escribió" v={texto(s.datos.ficha)} ancho />
          <Dato k="Nota de quien la envía" v={texto(s.datos.nota)} ancho />
        </dl>
      </Seccion>
      <Seccion titulo="Todo lo que envió" abierta={false}>
        <CamposDeFicha s={s} />
        <div className="mt-3">
          <Redes s={s} />
        </div>
      </Seccion>
    </>
  );
}

function ContenidoDeBaja({
  s,
  vista,
}: Readonly<{ s: SolicitudAdmin; vista: VistaPreviaSolicitud | null }>) {
  return (
    <Seccion titulo="La baja">
      <dl className="grid gap-2">
        <Dato k="Ficha que escribió" v={texto(s.datos.ficha)} ancho />
        <Dato k="Motivo" v={texto(s.datos.motivo)} ancho />
      </dl>
      {vista?.ficha && (
        <p className="mt-3 text-xs text-dex-muted">
          Ficha encontrada:{" "}
          <span className="font-mono text-dex-ink">
            #{String(vista.ficha.dexNumber).padStart(3, "0")}
          </span>{" "}
          {vista.ficha.name} · <EnlaceDeFicha slug={vista.ficha.slug} />
          {vista.ficha.grado && ` · grado ${vista.ficha.grado}`}
        </p>
      )}
    </Seccion>
  );
}

function ContactoConfidencial({
  contacto,
}: Readonly<{ contacto: NonNullable<SolicitudAdmin["contacto"]> }>) {
  return (
    <section
      className="rounded-xl border border-dex-line bg-dex-void/60 px-3 py-2 text-xs text-dex-muted"
      data-testid="solicitud-contacto"
    >
      <strong className="text-dex-ink">
        Contacto confidencial (no publicar):
      </strong>{" "}
      {/* Oculto hasta pulsar «Mostrar»: el mantenedor se usa en directo (ver dato-oculto.tsx). */}
      {contacto.email && (
        <DatoOculto valor={contacto.email}>
          <a
            href={`mailto:${contacto.email}`}
            className="break-all text-dex-accent underline underline-offset-2"
          >
            {contacto.email}
          </a>
        </DatoOculto>
      )}
      {contacto.realName && (
        <>
          {" · "}
          <DatoOculto valor={contacto.realName} etiqueta="nombre civil" />
        </>
      )}
    </section>
  );
}

function ResumenDeResuelta({ s }: Readonly<{ s: SolicitudAdmin }>) {
  return (
    <p
      className="rounded-xl border border-dex-line px-3 py-2 text-xs text-dex-muted"
      data-testid="solicitud-resuelta"
    >
      {s.estado} {s.resuelto ? haceCuanto(s.resuelto) : ""}
      {s.resueltoPor && (
        <>
          {" por "}
          <QuizasCorreo texto={s.resueltoPor} />
        </>
      )}
      {s.vtuberSlug && (
        <>
          {" · "}
          {s.tipo === "modificacion"
            ? "Ficha modificada: "
            : "Ficha creada (en borrador): "}
          <EnlaceDeFicha slug={s.vtuberSlug} />
        </>
      )}
      {s.nota ? ` · Nota: ${s.nota}` : ""}
    </p>
  );
}

/** Una modificación cuya ficha no se resolvió sola: el mantenedor la elige antes de aprobar. */
function hayQueElegirFicha(
  s: SolicitudAdmin,
  vista: VistaPreviaSolicitud | null,
): boolean {
  if (s.estado !== "pendiente" || s.tipo !== "modificacion") {
    return false;
  }
  return vista?.problema?.codigo === "ficha_no_encontrada";
}

function ContenidoPorTipo({
  token,
  s,
  vista,
}: Readonly<{
  token: string;
  s: SolicitudAdmin;
  vista: VistaPreviaSolicitud | null;
}>) {
  if (s.tipo === "inscripcion") {
    return <ContenidoDeInscripcion token={token} s={s} />;
  }
  if (s.tipo === "modificacion") {
    return <ContenidoDeModificacion token={token} s={s} vista={vista} />;
  }
  return <ContenidoDeBaja s={s} vista={vista} />;
}

/** El detalle de la solicitud elegida: veredicto, acciones (si está pendiente) y el contenido por tipo. */
export function DetalleDeSolicitud({
  token,
  s,
  vista,
  cargandoVista,
  fichaElegida,
  onElegirFicha,
  ocupada,
  nota,
  onNota,
  rechazando,
  onRechazando,
  onResolver,
}: Readonly<{
  token: string;
  s: SolicitudAdmin;
  vista: VistaPreviaSolicitud | null;
  cargandoVista: boolean;
  fichaElegida: string | null;
  onElegirFicha: (slug: string | null) => void;
  ocupada: number | null;
  nota: string;
  onNota: (nota: string) => void;
  rechazando: boolean;
  onRechazando: (rechazando: boolean) => void;
  onResolver: (s: SolicitudAdmin, accion: Accion) => void;
}>) {
  const pendiente = s.estado === "pendiente";
  return (
    <article
      className="space-y-3 rounded-2xl border border-dex-line bg-dex-panel/60 p-4"
      data-testid="solicitud-detalle"
    >
      <CabeceraDelDetalle s={s} />

      <Veredicto vista={vista} cargando={cargandoVista} solicitud={s} />

      {hayQueElegirFicha(s, vista) && (
        <ElegirFicha
          token={token}
          candidatas={vista?.candidatas ?? []}
          elegida={fichaElegida}
          onElegir={onElegirFicha}
        />
      )}

      {pendiente && (
        <AccionesDeSolicitud
          s={s}
          vista={vista}
          cargandoVista={cargandoVista}
          ocupada={ocupada}
          nota={nota}
          onNota={onNota}
          rechazando={rechazando}
          onRechazando={onRechazando}
          onResolver={onResolver}
        />
      )}

      {/* ── contenido, según el tipo ───────────────────────────────────────── */}
      <ContenidoPorTipo token={token} s={s} vista={vista} />

      {s.contacto && <ContactoConfidencial contacto={s.contacto} />}

      {!pendiente && <ResumenDeResuelta s={s} />}
    </article>
  );
}
