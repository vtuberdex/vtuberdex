'use client';

/**
 * Página «Cómo funcionan los niveles» (`/niveles`): explica experiencia, niveles, EXP total y puntos de habilidad.
 * Las cifras (EXP por like, curva, puntos por nivel, rango máximo) salen de `server/src/experiencia.mjs`, la misma
 * regla que usa el servidor, y la tabla de niveles se CALCULA con `umbralDeNivel`: la explicación no puede
 * quedarse desfasada si algún día cambia la curva.
 */
import Link from 'next/link';

import { EscalaDeRangos, Figura, GraficoBarraYTotal, GraficoCurva, MaquetaFichaPublica, MaquetaMiFicha, PasosDelCamino } from '@/components/niveles/graficos';
import { useI18n } from '@/lib/i18n';
import { BASE_NIVEL, PASO_NIVEL, PUNTOS_POR_NIVEL, RANGO_MAXIMO, XP_POR_LIKE, umbralDeNivel } from '@/server/src/experiencia.mjs';

/** Hasta qué nivel llega la tabla de ejemplo. */
const NIVELES_EN_TABLA = 10;

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-dex-line bg-dex-panel/60 p-5">
      <h2 className="text-lg font-bold text-dex-ink">{titulo}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-dex-ink/85">{children}</div>
    </section>
  );
}

export function NivelesContenido() {
  const { t, locale } = useI18n();
  const cifras = { xp: XP_POR_LIKE, base: BASE_NIVEL, paso: PASO_NIVEL, pts: PUNTOS_POR_NIVEL, max: RANGO_MAXIMO };
  const fmt = (n: number) => n.toLocaleString(locale);
  // «Para subir al nivel N» pide lo que vale el nivel N-1.
  const filas = Array.from({ length: NIVELES_EN_TABLA - 1 }, (_, i) => {
    const nivel = i + 2;
    const exp = umbralDeNivel(nivel - 1);
    return { nivel, exp, likes: Math.ceil(exp / XP_POR_LIKE) };
  });

  return (
    <main className="mx-auto w-full max-w-2xl space-y-5 px-4 py-10 sm:px-6" data-testid="niveles">
      <header>
        <h1 className="text-2xl font-extrabold text-dex-ink">{t('niveles.titulo')}</h1>
        <p className="mt-2 text-sm text-dex-muted">{t('niveles.intro')}</p>
      </header>

      <PasosDelCamino />

      <Seccion titulo={t('niveles.s1.titulo')}>
        <p>{t('niveles.s1.texto', cifras)}</p>
      </Seccion>

      <Seccion titulo={t('niveles.s2.titulo')}>
        <p>{t('niveles.s2.texto', cifras)}</p>
        <Figura titulo={t('niveles.g2.titulo')} texto={t('niveles.g2.texto')}>
          <GraficoCurva />
        </Figura>
        <table className="w-full text-left text-xs" data-testid="niveles-tabla">
          <caption className="mb-1 text-left text-[11px] uppercase tracking-[0.12em] text-dex-muted">{t('niveles.tabla.titulo')}</caption>
          <thead className="text-dex-muted">
            <tr>
              <th className="py-1 pr-3 font-normal">{t('niveles.tabla.nivel')}</th>
              <th className="pr-3 text-right font-normal">{t('niveles.tabla.exp')}</th>
              <th className="text-right font-normal">{t('niveles.tabla.likes')}</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.nivel} className="border-t border-dex-line/60">
                <td className="py-1 pr-3 font-mono">{f.nivel}</td>
                <td className="pr-3 text-right font-mono">{fmt(f.exp)}</td>
                <td className="text-right font-mono">{fmt(f.likes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Seccion>

      <Seccion titulo={t('niveles.s3.titulo')}>
        <p>{t('niveles.s3.texto')}</p>
        <Figura titulo={t('niveles.g1.titulo')} texto={t('niveles.g1.texto')}>
          <GraficoBarraYTotal />
        </Figura>
        <Figura titulo={t('niveles.m1.titulo')} texto={t('niveles.m1.texto')} ejemplo>
          <MaquetaFichaPublica />
        </Figura>
      </Seccion>

      <Seccion titulo={t('niveles.s4.titulo')}>
        <p>{t('niveles.s4.texto', cifras)}</p>
        <p className="text-xs text-dex-muted">{t('niveles.s4.aviso')}</p>
        <Figura titulo={t('niveles.m3.titulo')} texto={t('niveles.m3.texto', cifras)}>
          <EscalaDeRangos />
        </Figura>
      </Seccion>

      <Seccion titulo={t('niveles.s5.titulo')}>
        <ol className="list-decimal space-y-2 pl-5">
          <li>{t('niveles.s5.paso1')}</li>
          <li>{t('niveles.s5.paso2')}</li>
          <li>{t('niveles.s5.paso3')}</li>
        </ol>
        <Figura titulo={t('niveles.m2.titulo')} texto={t('niveles.m2.texto')} ejemplo>
          <MaquetaMiFicha />
        </Figura>
        <p className="text-xs text-dex-muted">{t('niveles.s5.nota')}</p>
        <Link href="/mi-ficha" className="inline-block rounded-xl bg-dex-accent px-5 py-2.5 text-sm font-bold text-black">
          {t('niveles.s5.boton')}
        </Link>
      </Seccion>

      <Seccion titulo={t('niveles.s6.titulo')}>
        <dl className="space-y-3">
          {(['1', '2', '3', '4'] as const).map((n) => (
            <div key={n}>
              <dt className="font-bold text-dex-ink">{t(`niveles.q${n}` as const)}</dt>
              <dd className="mt-0.5">{t(`niveles.a${n}` as const)}</dd>
            </div>
          ))}
        </dl>
      </Seccion>

      <Link href="/" className="inline-block text-sm text-dex-accent underline underline-offset-2">
        {t('niveles.volver')}
      </Link>
    </main>
  );
}

export default NivelesContenido;
