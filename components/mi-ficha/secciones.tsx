// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
"use client";

/**
 * Las piezas de «Mi ficha» que no llevan estado propio de la pantalla: la fila con su botón «+ Subir», la
 * confirmación de reinicio y las secciones de stats, misiones y Minecraft. Viven aparte de `mi-ficha.tsx`
 * para que la pantalla (lógica + vista) se lea de un tirón; las comparte la maqueta de `/niveles` a través
 * de `MiFichaVista`, así que cambiar algo aquí cambia las dos.
 */
import { useState } from "react";

import { claseBoton } from "@/components/solicitudes/campos";
import type {
  EstadoDeStats,
  EstadoMinecraft,
  MisionesDeFicha,
  MisionVista,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { Clave } from "@/lib/i18n/mensajes";
import { miFichaEs } from "@/lib/i18n/textos/mificha";
import { XP_JUEGO_MAX_DIA } from "@/server/src/experiencia.mjs";

const claseSubir =
  "rounded-lg border border-dex-accent px-3 py-1.5 text-xs font-bold text-dex-accent hover:bg-dex-accent/15 disabled:cursor-not-allowed disabled:border-dex-line disabled:text-dex-muted disabled:hover:bg-transparent";
export const claseSecundario =
  "rounded-xl border border-dex-line px-4 py-2 text-sm text-dex-muted hover:text-dex-ink";

/** Los puntitos del rango: llenos los que ya tiene, vacíos los que faltan. */
export function Rango({
  n,
  max,
  etiqueta,
}: Readonly<{
  n: number;
  max: number;
  etiqueta: string;
}>) {
  return (
    <span className="flex items-center gap-1" role="img" aria-label={etiqueta}>
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          className={`h-2.5 w-2.5 rounded-full ${i < n ? "bg-dex-accent" : "border border-dex-line"}`}
        />
      ))}
    </span>
  );
}

/** Qué dice el botón de una fila: el máximo manda sobre «subiendo» (una fila al máximo no se puede pulsar). */
function etiquetaDeSubir(
  t: ReturnType<typeof useI18n>["t"],
  enMaximo: boolean,
  subiendo: boolean,
): string {
  if (enMaximo) {
    return t("mificha.maximo");
  }
  if (subiendo) {
    return t("mificha.subiendo");
  }
  return `+ ${t("mificha.subir")}`;
}

/**
 * Una fila con lo que se puede mejorar (habilidad o stat) y su botón «+ Subir». Recibe la `clave` y avisa con
 * ella: así la lista que la pinta no necesita una función nueva por fila.
 */
export function FilaSubible({
  testId,
  clave,
  nombre,
  detalle,
  deshabilitado,
  enMaximo,
  subiendo,
  alSubir,
}: Readonly<{
  testId: string;
  clave: string;
  nombre: string;
  detalle: React.ReactNode;
  deshabilitado: boolean;
  enMaximo: boolean;
  subiendo: boolean;
  alSubir: (clave: string, nombre: string) => void;
}>) {
  const { t } = useI18n();
  const subir = () => alSubir(clave, nombre);
  return (
    <li
      className="flex items-center gap-3 rounded-xl border border-dex-line/80 bg-black/25 px-4 py-3"
      data-testid={testId}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold text-dex-ink">
          {nombre}
        </span>
        {detalle}
      </span>
      <button
        type="button"
        disabled={deshabilitado}
        onClick={subir}
        className={claseSubir}
        aria-label={`${t("mificha.subir")}: ${nombre}`}
      >
        {etiquetaDeSubir(t, enMaximo, subiendo)}
      </button>
    </li>
  );
}

/** «¿Seguro?» antes de devolver los puntos repartidos de una bolsa. */
export function ConfirmarReinicio({
  texto,
  ocupada,
  alReiniciar,
  alConfirmar,
}: Readonly<{
  texto: string;
  ocupada: string | null;
  alReiniciar: () => void;
  alConfirmar: (abierto: boolean) => void;
}>) {
  const { t } = useI18n();
  return (
    <div className="space-y-3 rounded-xl border border-amber-300/40 bg-amber-300/10 p-4 text-sm text-dex-ink">
      <p>{texto}</p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={ocupada !== null}
          onClick={() => alReiniciar()}
          className={claseBoton}
        >
          {t("mificha.reiniciarSi")}
        </button>
        <button
          type="button"
          onClick={() => alConfirmar(false)}
          className={claseSecundario}
        >
          {t("mificha.reiniciarNo")}
        </button>
      </div>
    </div>
  );
}

/**
 * Los stats de «Mi ficha»: su propia bolsa de puntos (aparte de las habilidades) y la lista de los que se suben
 * gastándolos, más los que crecen solos con los niveles (solo lectura).
 */
export function SeccionStats({
  estado,
  ocupada,
  confirmando,
  alSubir,
  alReiniciar,
  alConfirmar,
}: Readonly<{
  estado: EstadoDeStats;
  ocupada: string | null;
  confirmando: boolean;
  alSubir: (slug: string, nombre: string) => void;
  alReiniciar: () => void;
  alConfirmar: (abierto: boolean) => void;
}>) {
  const { t } = useI18n();
  return (
    <section
      className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/60 p-5"
      data-testid="mificha-stats"
    >
      <div>
        <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-dex-muted">
          {t("mificha.statsTitulo")}
        </h3>
        <p
          className="mt-2 text-4xl font-extrabold text-dex-ink"
          data-testid="mificha-stats-disponibles"
        >
          {estado.disponibles}
        </p>
        <p className="mt-1 text-xs text-dex-muted">
          {t("mificha.statsTexto", { por: estado.puntosPorNivel })}
        </p>
        <p className="mt-1 text-xs text-dex-muted">
          {t("mificha.statsDisponibles", {
            n: estado.disponibles,
            a: estado.repartidos,
            b: estado.ganados,
          })}
        </p>
      </div>
      <ul className="space-y-2">
        {estado.stats.map((s) => (
          <FilaSubible
            key={s.slug}
            testId="mificha-stat"
            clave={s.slug}
            nombre={s.label}
            detalle={
              <span className="block font-mono text-xs text-dex-muted">
                {s.valor.toLocaleString()}{" "}
                <span className="opacity-70">
                  ({t("mificha.statsPaso", { paso: s.paso })})
                </span>
              </span>
            }
            deshabilitado={
              estado.disponibles < 1 || !s.puedeSubir || ocupada !== null
            }
            enMaximo={!s.puedeSubir}
            subiendo={ocupada === s.slug}
            alSubir={alSubir}
          />
        ))}
      </ul>
      {estado.repartidos > 0 &&
        (confirmando ? (
          <ConfirmarReinicio
            texto={t("mificha.statsReiniciarConfirma", {
              n: estado.repartidos,
            })}
            ocupada={ocupada}
            alReiniciar={alReiniciar}
            alConfirmar={alConfirmar}
          />
        ) : (
          <button
            type="button"
            onClick={() => alConfirmar(true)}
            className={claseSecundario}
          >
            {t("mificha.statsReiniciar")}
          </button>
        ))}
      {estado.automaticos.length > 0 && (
        <div data-testid="mificha-stats-auto">
          <h4 className="text-xs font-bold uppercase tracking-[0.14em] text-dex-muted">
            {t("mificha.statsAutoTitulo")}
          </h4>
          <p className="mt-1 text-xs text-dex-muted">
            {t("mificha.statsAutoTexto")}
          </p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {estado.automaticos.map((a) => (
              <li
                key={a.slug}
                className="rounded-xl border border-dex-line/80 bg-black/25 px-4 py-2"
              >
                <span className="block text-sm font-bold text-dex-ink">
                  {a.label}
                </span>
                <span className="block font-mono text-xs text-dex-muted">
                  {a.valor.toLocaleString()} ·{" "}
                  {t("mificha.statsAutoCada", { suma: a.suma, cada: a.cada })}
                  {a.tope !== null && (
                    <> · {t("mificha.statsAutoTope", { tope: a.tope })}</>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** Las claves de misiones y contadores que existen en los textos (es es la fuente de claves). */
const TEXTOS_MISION = new Set<string>(
  Object.keys(miFichaEs).filter((k) => k.startsWith("mision.") || k.startsWith("contador.")),
);

/** Nombre, descripción y etiquetas se traducen por id; si el servidor trae una misión que esta versión no conoce, sale su texto en español. */
function useTextoDeMision() {
  const { t } = useI18n();
  return (clave: string, respaldo: string) =>
    TEXTOS_MISION.has(clave) ? t(clave as Clave) : respaldo;
}

/** Las barras de avance de una misión, una por contador. */
function BarrasDeMision({ mision }: Readonly<{ mision: MisionVista }>) {
  const texto = useTextoDeMision();
  const n = (v: number) => v.toLocaleString();
  return (
    <ul className="mt-2 space-y-1.5">
      {mision.requisitos.map((r) => (
        <li key={r.contador}>
          <div className="flex justify-between text-[11px] text-dex-muted">
            <span>{texto(`contador.${r.contador}`, r.etiqueta)}</span>
            <span className="font-mono">
              {n(r.progreso)} / {n(r.meta)}
            </span>
          </div>
          <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-dex-accent"
              style={{ width: `${Math.min(100, (r.progreso / r.meta) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Una misión secundaria: da experiencia (diaria, semanal o de una vez). */
function MisionSecundaria({ mision: m }: Readonly<{ mision: MisionVista }>) {
  const { t } = useI18n();
  const texto = useTextoDeMision();
  return (
    <li
      className="rounded-xl border border-dex-line p-3"
      data-testid={`mision-${m.id}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-semibold text-dex-ink">
          {texto(`mision.${m.id}.nombre`, m.nombre)}
          {m.repetible && (
            <span className="ml-2 text-[11px] font-normal text-dex-muted">
              {m.repetible === "semanal"
                ? t("mificha.misionesSemanal")
                : t("mificha.misionesDiaria")}
            </span>
          )}
        </span>
        <span className="font-mono text-xs text-dex-accent">
          {m.completada
            ? t("mificha.misionesCompletada")
            : t("mificha.misionesXp", { n: m.xp })}
        </span>
      </div>
      <p className="text-xs text-dex-muted">
        {texto(`mision.${m.id}.descripcion`, m.descripcion)}
      </p>
      {!m.completada && <BarrasDeMision mision={m} />}
    </li>
  );
}

/** El «¿seguro?» de reclamar un grado, o el botón que lo abre. */
function ReclamoDeGrado({
  mision,
  grado,
  ocupada,
  confirmando,
  alPedirConfirmar,
  alReclamar,
}: Readonly<{
  mision: string;
  grado: string;
  ocupada: string | null;
  confirmando: boolean;
  alPedirConfirmar: (mision: string | null) => void;
  alReclamar: (mision: string, grado: string) => void;
}>) {
  const { t } = useI18n();
  const reclamar = () => {
    alPedirConfirmar(null);
    alReclamar(mision, grado);
  };
  const cancelar = () => alPedirConfirmar(null);
  const pedirConfirmar = () => alPedirConfirmar(mision);
  if (!confirmando) {
    return (
      <div className="mt-2 space-y-2">
        <button
          type="button"
          disabled={ocupada !== null}
          onClick={pedirConfirmar}
          className={claseBoton}
        >
          {t("mificha.misionesReclamar", { grado })}
        </button>
      </div>
    );
  }
  return (
    <div className="mt-2 space-y-2">
      <p className="text-xs text-dex-ink/85">
        {t("mificha.misionesConfirmar", { grado })}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={ocupada !== null}
          onClick={reclamar}
          className={claseBoton}
        >
          {ocupada === mision
            ? t("mificha.misionesReclamando")
            : t("mificha.misionesSi")}
        </button>
        <button type="button" onClick={cancelar} className={claseSecundario}>
          {t("mificha.misionesNo")}
        </button>
      </div>
    </div>
  );
}

/**
 * Lo que sigue a una misión de grado completada y sin reclamar: «Reclamar» si se puede, o el motivo por el
 * que no. Nada en cualquier otro caso.
 */
function AccionDeGrado({
  mision: m,
  grado,
  ocupada,
  confirmando,
  alPedirConfirmar,
  alReclamar,
}: Readonly<{
  mision: MisionVista;
  grado: string;
  ocupada: string | null;
  confirmando: boolean;
  alPedirConfirmar: (mision: string | null) => void;
  alReclamar: (mision: string, grado: string) => void;
}>) {
  const { t } = useI18n();
  const porReclamar = m.completada && !m.reclamada;
  if (!porReclamar) {
    return null;
  }
  if (m.reclamable) {
    return (
      <ReclamoDeGrado
        mision={m.id}
        grado={grado}
        ocupada={ocupada}
        confirmando={confirmando}
        alPedirConfirmar={alPedirConfirmar}
        alReclamar={alReclamar}
      />
    );
  }
  if (!m.motivo) {
    return null;
  }
  return (
    <p className="mt-2 text-xs text-dex-muted">
      {t(`mificha.misionesMotivo.${m.motivo}`)}
    </p>
  );
}

/**
 * Una misión de grado: completada y sin reclamar ofrece «Reclamar» (con su «¿seguro?», porque cambia la carta
 * pública) o explica por qué no se puede. `confirmando` lo guarda la sección: solo una a la vez pide confirmar.
 */
function MisionDeGrado({
  mision: m,
  ocupada,
  confirmando,
  alPedirConfirmar,
  alReclamar,
}: Readonly<{
  mision: MisionVista;
  ocupada: string | null;
  confirmando: boolean;
  alPedirConfirmar: (mision: string | null) => void;
  alReclamar: (mision: string, grado: string) => void;
}>) {
  const { t } = useI18n();
  const texto = useTextoDeMision();
  const grado = m.grado ?? "";
  return (
    <li
      className="rounded-xl border border-dex-line p-3"
      data-testid={`mision-${m.id}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-semibold text-dex-ink">
          {texto(`mision.${m.id}.nombre`, m.nombre)}
        </span>
        {m.reclamada && (
          <span className="font-mono text-xs text-dex-accent">
            {t("mificha.misionesReclamada", { grado })}
          </span>
        )}
      </div>
      <p className="text-xs text-dex-muted">
        {texto(`mision.${m.id}.descripcion`, m.descripcion)}
      </p>
      {!m.completada && <BarrasDeMision mision={m} />}
      <AccionDeGrado
        mision={m}
        grado={grado}
        ocupada={ocupada}
        confirmando={confirmando}
        alPedirConfirmar={alPedirConfirmar}
        alReclamar={alReclamar}
      />
    </li>
  );
}

/**
 * Misiones de Minecraft: las secundarias dan experiencia; las de grado son difíciles y OPCIONALES, y completarlas da el
 * derecho a reclamar un grado de carta (la placa de acrílico). Reclamar pide confirmación: cambia la carta pública.
 * Los nombres y descripciones vienen del catálogo del servidor (español).
 */
export function SeccionMisiones({
  misiones,
  ocupada,
  alReclamar,
}: Readonly<{
  misiones: MisionesDeFicha;
  ocupada: string | null;
  alReclamar: (mision: string, grado: string) => void;
}>) {
  const { t } = useI18n();
  const [confirmar, setConfirmar] = useState<string | null>(null);
  return (
    <section
      className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/60 p-5"
      data-testid="mificha-misiones"
    >
      <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-dex-muted">
        {t("mificha.misionesTitulo")}
      </h3>
      <p className="text-sm text-dex-ink/85">{t("mificha.misionesTexto")}</p>

      <div>
        <h4 className="text-xs font-bold uppercase tracking-[0.14em] text-dex-muted">
          {t("mificha.misionesSecundarias")}
        </h4>
        <ul className="mt-2 space-y-2">
          {misiones.secundarias.map((m) => (
            <MisionSecundaria key={m.id} mision={m} />
          ))}
        </ul>
      </div>

      <div>
        <h4 className="text-xs font-bold uppercase tracking-[0.14em] text-dex-muted">
          {t("mificha.misionesGrado")}
        </h4>
        <ul className="mt-2 space-y-2">
          {misiones.grado.map((m) => (
            <MisionDeGrado
              key={m.id}
              mision={m}
              ocupada={ocupada}
              confirmando={confirmar === m.id}
              alPedirConfirmar={setConfirmar}
              alReclamar={alReclamar}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * Vincular la cuenta de Minecraft: un código de un uso que se escribe en el chat del juego. El código se muestra UNA
 * vez (solo se guarda su hash) y caduca en 10 minutos; pedir otro invalida el anterior.
 */
export function SeccionMinecraft({
  estado,
  codigo,
  ocupada,
  alPedirCodigo,
  alDesvincular,
}: Readonly<{
  estado: EstadoMinecraft;
  codigo: string | null;
  ocupada: string | null;
  alPedirCodigo: () => void;
  alDesvincular: () => void;
}>) {
  const { t } = useI18n();
  return (
    <section
      className="space-y-3 rounded-2xl border border-dex-line bg-dex-panel/60 p-5"
      data-testid="mificha-minecraft"
    >
      <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-dex-muted">
        {t("mificha.minecraftTitulo")}
      </h3>
      <p className="text-sm text-dex-ink/85">
        {t("mificha.minecraftTexto", { tope: XP_JUEGO_MAX_DIA })}
      </p>
      {estado.vinculado && (
        <p className="text-sm text-dex-ink">
          {estado.jugador
            ? t("mificha.minecraftVinculado", { jugador: estado.jugador })
            : t("mificha.minecraftVinculadoSinNombre")}
        </p>
      )}
      {estado.xpJuego > 0 && (
        <p className="text-xs text-dex-muted">
          {t("mificha.minecraftXp", { n: estado.xpJuego.toLocaleString() })}
        </p>
      )}
      {codigo && (
        <div className="rounded-xl border border-dex-accent/40 bg-black/30 p-4">
          <p className="text-xs text-dex-muted">
            {t("mificha.minecraftCodigo")}
          </p>
          <p
            className="mt-1 select-all font-mono text-lg font-bold text-dex-ink"
            data-testid="mificha-minecraft-codigo"
          >
            /vtd vincular {codigo}
          </p>
          <p className="mt-1 text-xs text-dex-muted">
            {t("mificha.minecraftCodigoVence")}
          </p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={ocupada !== null}
          onClick={alPedirCodigo}
          className={claseBoton}
        >
          {ocupada === "minecraft"
            ? t("mificha.minecraftPidiendo")
            : t("mificha.minecraftPedir")}
        </button>
        {estado.vinculado && (
          <button
            type="button"
            disabled={ocupada !== null}
            onClick={alDesvincular}
            className={claseSecundario}
          >
            {t("mificha.minecraftDesvincular")}
          </button>
        )}
      </div>
    </section>
  );
}
