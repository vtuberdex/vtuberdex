// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
"use client";
/** Stats del VTuber en barras normalizadas + nivel y EXP. */
import { rangoDelNivel } from "@/lib/rangos";
import { useI18n } from "@/lib/i18n";
import { etiquetaDeStat } from "@/lib/i18n/nombres";
import { StatRadar } from "@/components/stat-radar";
import { EJES_DE_RADAR, MIN_EJES, verticesDeRadar } from "@/lib/radar";
import type { StatRow } from "@/lib/types";

export interface StatBarsProps {
  stats: StatRow[];
  palette: { accent: string; secondary: string };
  level: number | null;
  experience: {
    current: number | null;
    max: number | null;
    total?: number;
  } | null;
}

/** Máximos de referencia para escalar las barras (los datos del origen son 0-400). */
const REFERENCE_MAX = 400;

export function StatBars({
  stats,
  palette,
  level,
  experience,
}: Readonly<StatBarsProps>) {
  const { t, locale } = useI18n();
  const numeric = stats.filter((stat) => typeof stat.value === "number");

  /**
   * Con tres o más atributos de combate se dibuja la TELARAÑA y las barras se quedan solo con lo
   * que la telaraña no puede mostrar (HP, MP y cualquier atributo fuera de sus ejes): repetir los
   * mismos números en barras debajo del gráfico sería ruido. Con menos de tres, todo en barras.
   */
  const enRadar = verticesDeRadar(stats).length >= MIN_EJES;
  const slugsDelRadar = new Set(EJES_DE_RADAR.map((eje) => eje.slug));
  const enBarras = enRadar
    ? numeric.filter((stat) => !slugsDelRadar.has(stat.slug))
    : numeric;

  const expPercent = porcentajeDeExperiencia(experience);

  return (
    <section
      className="rounded-2xl border border-dex-line bg-dex-panel/60 p-5"
      data-testid="stat-bars"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-dex-muted">
          {t("atributos.titulo")}
        </h2>
        {level !== null && <InsigniaDeNivel level={level} />}
      </div>

      {experience && expPercent !== null && (
        <BarraDeExperiencia
          experience={experience}
          percent={expPercent}
          accent={palette.accent}
        />
      )}

      {/*
        El nivel y la experiencia se muestran SIEMPRE: salen de los likes (`experienciaConLikes`) y
        existen aunque la ficha no tenga atributos. Antes, sin stats solo salía «Sin stats
        publicados» y los likes parecían no hacer nada.
      */}
      {numeric.length === 0 && (
        <p className="mt-4 text-sm text-dex-muted">{t("atributos.sinStats")}</p>
      )}

      {enRadar && <StatRadar stats={stats} palette={palette} />}

      <ul className="mt-4 space-y-3">
        {enBarras.map((stat) => {
          const max = stat.max ?? REFERENCE_MAX;
          const value = stat.value ?? 0;
          const percent = Math.max(
            4,
            Math.min(100, Math.round((value / Math.max(max, 1)) * 100)),
          );
          return (
            <li key={`${stat.slug}-${stat.position}`}>
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="uppercase tracking-[0.1em] text-dex-muted">
                  {etiquetaDeStat(locale, stat.slug, stat.label)}
                </span>
                <span className="font-mono text-dex-ink">
                  {value}
                  {stat.max ? ` / ${stat.max}` : ""}
                </span>
              </div>
              <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-white/8">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{
                    width: `${percent}%`,
                    background: `linear-gradient(90deg, ${palette.accent}, ${palette.secondary})`,
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

type Experiencia = NonNullable<StatBarsProps["experience"]>;

/** Llenado de la barra de EXP (0-100), o `null` si falta el valor o el tope del nivel. */
function porcentajeDeExperiencia(
  experience: StatBarsProps["experience"],
): number | null {
  const current = experience?.current;
  const max = experience?.max;
  if (current === null || current === undefined || !max) {
    return null;
  }
  return Math.min(100, Math.round((current / max) * 100));
}

/** Rango (con el siguiente en el `title`) y nivel, a la derecha del título. */
function InsigniaDeNivel({ level }: Readonly<{ level: number }>) {
  const { t } = useI18n();
  const rango = rangoDelNivel(level);
  const titulo = rango?.siguiente
    ? t("rango.sig", {
        rango: t(`rango.${rango.siguiente.id}`),
        n: rango.siguiente.desde,
      })
    : t("rango.max");
  return (
    <span className="flex items-center gap-2">
      <span
        className="rounded-lg border border-dex-accent/50 px-2 py-0.5 text-xs font-bold uppercase tracking-[0.1em] text-dex-accent"
        data-testid="rango"
        title={titulo}
      >
        {rango ? t(`rango.${rango.id}`) : ""}
      </span>
      <span className="rounded-lg border border-dex-line px-2 py-0.5 font-mono text-xs text-dex-ink">
        {t("atributos.nivel", { n: level })}
      </span>
    </span>
  );
}

function BarraDeExperiencia({
  experience,
  percent,
  accent,
}: Readonly<{ experience: Experiencia; percent: number; accent: string }>) {
  const { t, locale } = useI18n();
  return (
    <div className="mt-4">
      <div className="flex justify-between text-[11px] uppercase tracking-[0.12em] text-dex-muted">
        <span>{t("atributos.experiencia")}</span>
        <span className="font-mono">
          {experience.current} / {experience.max}
        </span>
      </div>
      <div
        className="mt-1 h-2 w-full overflow-hidden rounded-full bg-white/10"
        role="progressbar"
        aria-label={t("atributos.experiencia")}
        aria-valuemin={0}
        aria-valuemax={experience.max ?? 0}
        aria-valuenow={experience.current ?? 0}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${percent}%`, background: accent }}
        />
      </div>
      {typeof experience.total === "number" && (
        <p
          className="mt-1.5 flex justify-between text-[11px] uppercase tracking-[0.12em] text-dex-muted"
          data-testid="exp-total"
        >
          <span>{t("atributos.expTotal")}</span>
          <span className="font-mono">
            {experience.total.toLocaleString(locale)}
          </span>
        </p>
      )}
    </div>
  );
}

export default StatBars;
