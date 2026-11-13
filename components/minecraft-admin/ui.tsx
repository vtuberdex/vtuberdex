// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * Piezas visuales del mantenedor de Minecraft, con los tokens del sistema de diseño de la web
 * (`docs/sistema-de-diseno.md`: `dex-void`, `dex-panel`, `dex-line`, `dex-accent`…). Antes el
 * panel usaba bordes y botones negros por defecto, casi invisibles sobre el fondo oscuro.
 *
 * Los colores de estado (verde/ámbar/rojo) son SEMÁNTICOS y solo marcan estado, nunca decoran:
 * son los tonos `exito`/`aviso`/`peligro` del sistema (Tailwind emerald/amber/red 400).
 * Texto sobre el acento siempre es `dex-void`.
 */
import type { ReactNode } from "react";

export const CLASE_TARJETA =
  "rounded-2xl border border-dex-line bg-dex-panel/60 p-5";

/**
 * Monoespaciada REAL. `font-mono` de Tailwind no sirve aquí: el tema de la web la redefine como
 * Asul (`--font-mono` en globals.css), así que comandos, nombres y registros salían en la serif.
 */
export const FUENTE_MONO =
  "font-[ui-monospace,SFMono-Regular,Menlo,Consolas,monospace]";

export const CLASE_CAMPO =
  "w-full rounded-xl border border-dex-line bg-dex-void/60 px-3 py-2 text-sm text-dex-ink placeholder:text-dex-muted focus:border-dex-accent focus:outline-none";

const BASE_BOTON =
  "rounded-xl text-sm transition disabled:cursor-not-allowed disabled:opacity-50";
/** Campo de texto para nombres, motivos, comandos y archivos: lo que se copia y pega. */
export const CLASE_CAMPO_MONO = `${CLASE_CAMPO} ${FUENTE_MONO}`;

export const CLASE_BOTON = {
  primario: `${BASE_BOTON} bg-dex-accent px-4 py-2 font-bold text-dex-void hover:brightness-110`,
  secundario: `${BASE_BOTON} border border-dex-line bg-dex-panel-soft px-3 py-1.5 text-dex-ink hover:border-dex-accent/60`,
  peligro: `${BASE_BOTON} border border-red-400/40 px-3 py-1.5 text-red-400 hover:bg-red-400/10`,
  fantasma: `${BASE_BOTON} px-2 py-1 text-dex-muted hover:text-dex-ink`,
} as const;

export type Tono = "bien" | "ojo" | "mal" | "neutro" | "acento";

const TONO_TEXTO: Record<Tono, string> = {
  bien: "text-emerald-400",
  ojo: "text-amber-400",
  mal: "text-red-400",
  neutro: "text-dex-ink",
  acento: "text-dex-accent",
};
const TONO_PILDORA: Record<Tono, string> = {
  bien: "border-emerald-400/40 bg-emerald-400/10 text-emerald-400",
  ojo: "border-amber-400/40 bg-amber-400/10 text-amber-400",
  mal: "border-red-400/40 bg-red-400/10 text-red-400",
  neutro: "border-dex-line bg-dex-panel-soft text-dex-muted",
  acento: "border-dex-accent/40 bg-dex-accent/10 text-dex-accent",
};
const TONO_PUNTO: Record<Tono, string> = {
  bien: "bg-emerald-400",
  ojo: "bg-amber-400",
  mal: "bg-red-400",
  neutro: "bg-dex-muted",
  acento: "bg-dex-accent",
};

export function textoDeTono(t: Tono) {
  return TONO_TEXTO[t];
}

/** Etiqueta redonda de estado, con punto de color. */
export function Pildora({
  tono = "neutro",
  children,
  conPunto = true,
}: {
  tono?: Tono;
  children: ReactNode;
  conPunto?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${TONO_PILDORA[tono]}`}
    >
      {conPunto ? (
        <span
          aria-hidden="true"
          className={`size-2 rounded-full ${TONO_PUNTO[tono]}`}
        />
      ) : null}
      {children}
    </span>
  );
}

/** Contenedor de una sección: título, bajada opcional y acciones a la derecha. */
export function Seccion({
  titulo,
  bajada,
  acciones,
  children,
  className = "",
}: {
  titulo: string;
  bajada?: string;
  acciones?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`${CLASE_TARJETA} space-y-4 ${className}`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg text-dex-ink">{titulo}</h2>
          {bajada ? <p className="text-xs text-dex-muted">{bajada}</p> : null}
        </div>
        {acciones}
      </header>
      {children}
    </section>
  );
}

/** Mini gráfica de tendencia en SVG: sin librería, solo la forma de los últimos minutos. */
export function Tendencia({
  valores,
  tono = "acento",
}: {
  valores: number[];
  tono?: Tono;
}) {
  if (valores.length < 2) {
    return <div className="h-9" aria-hidden="true" />;
  }
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const rango = max - min || 1;
  const y = (v: number) => (32 - ((v - min) / rango) * 28 - 2).toFixed(1);
  const x = (i: number) => ((i / (valores.length - 1)) * 100).toFixed(1);
  const linea = valores.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  return (
    <svg
      viewBox="0 0 100 34"
      preserveAspectRatio="none"
      className={`mt-2 h-9 w-full ${TONO_TEXTO[tono]}`}
      aria-hidden="true"
    >
      <polygon
        points={`0,34 ${linea} 100,34`}
        fill="currentColor"
        opacity="0.12"
      />
      <polyline
        points={linea}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** Indicador grande del dashboard: etiqueta, valor, detalle y (opcional) tendencia. */
export function Indicador({
  titulo,
  valor,
  detalle,
  tono = "neutro",
  valores,
}: {
  titulo: string;
  valor: string;
  detalle?: string;
  tono?: Tono;
  valores?: number[];
}) {
  return (
    <div className={`${CLASE_TARJETA} !p-4`}>
      <p className="text-xs uppercase tracking-wider text-dex-muted">
        {titulo}
      </p>
      <p
        className={`mt-1 font-[family-name:var(--font-heading)] text-4xl leading-tight tabular-nums ${TONO_TEXTO[tono]}`}
      >
        {valor}
      </p>
      {detalle ? <p className="text-xs text-dex-muted">{detalle}</p> : null}
      {valores ? (
        <Tendencia
          valores={valores}
          tono={tono === "neutro" ? "acento" : tono}
        />
      ) : null}
    </div>
  );
}
