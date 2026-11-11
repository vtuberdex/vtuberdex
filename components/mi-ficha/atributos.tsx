"use client";

/**
 * Los seis atributos RPG de «Mi ficha» (STR, DEX, CON, INT, WIS, CHA): 200 puntos por repartir, el
 * bono de las facciones encima (sin gastar puntos) y los stats que salen de ahí en vivo.
 *
 * Las fórmulas NO se escriben aquí: se importan del mismo módulo que usa el servidor
 * (`server/src/atributos.mjs`), así que lo que se ve mientras se reparte es exactamente lo que se
 * guarda (incluido el redondeo y el tope de 100 por atributo).
 *
 * Se reparte UNA vez: cuando la ficha ya tiene sus atributos (o ya traía stats propios) el bloque
 * solo se muestra en lectura, que una build no cambie por un clic de más.
 */
import { useEffect, useState } from "react";

import { claseBoton } from "@/components/solicitudes/campos";
import type { EstadoDeAtributos } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { Clave } from "@/lib/i18n/mensajes";
import {
  ATRIBUTO_MAXIMO,
  PUNTOS_DE_ATRIBUTOS,
  atributosFinales,
  statsDerivados,
} from "@/server/src/atributos.mjs";

export function AtributosPanel({
  estado,
  ocupada,
  alGuardar,
}: {
  estado: EstadoDeAtributos;
  ocupada: string | null;
  alGuardar: (puntos: Record<string, number>) => void;
}) {
  const { t } = useI18n();
  const [puntos, setPuntos] = useState<Record<string, number>>(estado.puntos);

  // Al guardar (o al cambiar de ficha) se vuelve a lo que hay en el servidor.
  useEffect(() => setPuntos(estado.puntos), [estado]);

  // Una ficha que ya traía stats propios no entra en el reparto: sus valores mandan y no se tocan.
  if (estado.tieneStatsDeOrigen) return null;

  const repartidos = Object.values(puntos).reduce(
    (suma, n) => suma + (Number(n) || 0),
    0,
  );
  const disponibles = Math.max(0, PUNTOS_DE_ATRIBUTOS - repartidos);
  const finales = atributosFinales(puntos, estado.bonos);
  const derivados = statsDerivados(finales);
  const cambiado =
    repartidos !== estado.repartidos ||
    finales.some((a) => a.puntos !== (estado.puntos[a.slug] ?? 0));

  const fijar = (slug: string, valor: string) => {
    // Lo que cabe: 60 sin bono, 40 con un bono de +20 (los 40 de base cuentan para el tope) y
    // nunca más de los puntos que quedan por repartir.
    const cabe = finales.find((a) => a.slug === slug)?.maximoAsignable ?? 0;
    const n = Math.max(
      0,
      Math.min(Math.trunc(Number(valor) || 0), cabe, disponibles + (puntos[slug] ?? 0)),
    );
    setPuntos((actual) => ({ ...actual, [slug]: n }));
  };

  return (
    <section
      className="rounded-2xl border border-dex-line bg-dex-panel/60 p-5"
      data-testid="mificha-atributos"
    >
      <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-dex-muted">
        {t("mificha.atrTitulo" as Clave)}
      </h3>
      <p className="mt-2 text-sm text-dex-ink/85">
        {t("mificha.atrTexto" as Clave, { total: PUNTOS_DE_ATRIBUTOS })}
      </p>
      <p
        className="mt-3 text-2xl font-extrabold text-dex-ink"
        data-testid="mificha-atributos-disponibles"
      >
        {t("mificha.atrDisponibles" as Clave, {
          n: disponibles,
          total: PUNTOS_DE_ATRIBUTOS,
        })}
      </p>

      <ul className="mt-3 space-y-2">
        {finales.map((atributo) => (
          <li
            key={atributo.slug}
            className="flex items-center justify-between gap-3 rounded-xl border border-dex-line/60 px-3 py-2"
          >
            <span className="text-sm font-bold text-dex-ink">
              {atributo.label}
              {atributo.bono > 0 && (
                <span className="ml-2 text-xs font-normal text-dex-accent">
                  {t("mificha.atrBono" as Clave, { n: atributo.bono })}
                </span>
              )}
            </span>
            <span className="flex items-center gap-2">
              {estado.puedeEditar ? (
                <input
                  type="number"
                  min={0}
                  max={atributo.maximoAsignable}
                  value={puntos[atributo.slug] ?? 0}
                  onChange={(e) => fijar(atributo.slug, e.target.value)}
                  aria-label={atributo.label}
                  className="w-20 rounded-lg border border-dex-line bg-dex-bg px-2 py-1 text-right font-mono text-dex-ink"
                />
              ) : (
                <span className="font-mono text-dex-ink">{atributo.puntos}</span>
              )}
              <span className="w-14 text-right font-mono text-lg font-bold text-dex-accent">
                {atributo.valor}
              </span>
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs text-dex-muted">
        {t("mificha.atrSuma" as Clave, {
          a: repartidos,
          b: PUNTOS_DE_ATRIBUTOS,
        })}
      </p>

      <h4 className="mt-4 text-xs uppercase tracking-[0.14em] text-dex-muted">
        {t("mificha.atrDerivados" as Clave)}
      </h4>
      <ul className="mt-2 grid grid-cols-2 gap-1 text-sm text-dex-ink/85 sm:grid-cols-3">
        {derivados.map((stat) => (
          <li key={stat.slug} className="flex justify-between gap-2">
            <span>{stat.label}</span>
            <span className="font-mono" data-testid={`mificha-atr-${stat.slug}`}>
              {stat.value}
            </span>
          </li>
        ))}
      </ul>

      {estado.puedeEditar ? (
        <button
          type="button"
          onClick={() => alGuardar(puntos)}
          disabled={ocupada !== null || !cambiado}
          className={`mt-4 ${claseBoton}`}
          data-testid="mificha-atributos-guardar"
        >
          {t("mificha.atrGuardar" as Clave)}
        </button>
      ) : (
        <p className="mt-4 text-xs text-dex-muted">
          {t("mificha.atrBloqueado" as Clave)}
        </p>
      )}
    </section>
  );
}
