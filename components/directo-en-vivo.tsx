"use client";
/**
 * Directo y contenido del VTuber: «en directo ahora» (título y espectadores) en Twitch, YouTube y Kick, y
 * estadísticas públicas y últimos vídeos de YouTube. Todo lo resuelve el servidor (`api.directo`); sin
 * credenciales configuradas o sin canales soportados no llega nada y la sección NO se pinta.
 *
 * Es un adorno de la ficha: un error de red se traga y la ficha sigue igual. Se refresca cada 2 minutos
 * mientras la pestaña está visible (el servidor cachea 1-5 min, así que no cuesta más llamadas a las plataformas).
 */
import { useEffect, useState } from "react";

import { SocialIcon } from "@/components/social-icon";
import { api, type CanalDirecto } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const REFRESCO_MS = 120_000;
const NOMBRES = { twitch: "Twitch", youtube: "YouTube", kick: "Kick" } as const;

export function DirectoEnVivo({
  slug,
  palette,
}: {
  slug: string;
  palette: { accent: string; secondary: string };
}) {
  const { t, locale } = useI18n();
  const [canales, setCanales] = useState<CanalDirecto[]>([]);

  useEffect(() => {
    const control = new AbortController();
    const cargar = () => {
      if (document.visibilityState === "hidden") return;
      api
        .directo(slug, control.signal)
        .then((r) => setCanales(r.canales))
        .catch(() => {});
    };
    setCanales([]);
    cargar();
    const intervalo = setInterval(cargar, REFRESCO_MS);
    return () => {
      control.abort();
      clearInterval(intervalo);
    };
  }, [slug]);

  if (canales.length === 0) return null;
  const n = (valor: number) => valor.toLocaleString(locale);
  const youtube = canales.find((c) => c.plataforma === "youtube");
  const stats = youtube?.estadisticas;

  return (
    <section
      className="rounded-2xl border border-dex-line bg-dex-panel/60 p-5"
      data-testid="directo-en-vivo"
    >
      <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-dex-muted">
        {t("directo.titulo")}
      </h2>

      <ul className="mt-3 space-y-2">
        {canales.map((canal) => {
          const plataforma = NOMBRES[canal.plataforma];
          const destino = canal.enVivo && canal.enlace ? canal.enlace : canal.url;
          return (
            <li key={`${canal.plataforma}-${canal.url}`}>
              <a
                href={destino}
                target="_blank"
                rel="noreferrer noopener nofollow"
                data-testid={`directo-${canal.plataforma}`}
                className="flex items-center gap-3 rounded-xl border border-dex-line px-3 py-2 text-sm transition-colors hover:border-dex-accent/60"
              >
                <SocialIcon
                  platform={plataforma}
                  url={canal.url}
                  color={palette.accent}
                />
                {canal.enVivo ? (
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-red-600 px-1.5 py-0.5 text-[0.65rem] font-bold tracking-wider text-white">
                        {t("directo.envivo")}
                      </span>
                      {typeof canal.espectadores === "number" && (
                        <span className="text-dex-muted">
                          {t("directo.espectadores", { n: n(canal.espectadores) })}
                        </span>
                      )}
                    </span>
                    {canal.titulo && (
                      <span className="mt-0.5 block truncate text-dex-ink/90">
                        {canal.titulo}
                      </span>
                    )}
                    {canal.categoria && (
                      <span className="block truncate text-xs text-dex-muted">
                        {canal.categoria}
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="text-dex-muted">
                    {t("directo.sinDirecto", { plataforma })}
                  </span>
                )}
              </a>
            </li>
          );
        })}
      </ul>

      {stats && (
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-dex-muted">
          {stats.suscriptores !== null && (
            <span>{t("directo.suscriptores", { n: n(stats.suscriptores) })}</span>
          )}
          {stats.vistas !== null && (
            <span>{t("directo.vistas", { n: n(stats.vistas) })}</span>
          )}
          {stats.videos !== null && (
            <span>{t("directo.videos", { n: n(stats.videos) })}</span>
          )}
        </p>
      )}

      {youtube?.videos && youtube.videos.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-dex-muted">
            {t("directo.ultimos")}
          </h3>
          <ul className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {youtube.videos.map((video) => (
              <li key={video.id}>
                <a
                  href={video.url}
                  target="_blank"
                  rel="noreferrer noopener nofollow"
                  className="block overflow-hidden rounded-xl border border-dex-line transition-colors hover:border-dex-accent/60"
                >
                  {video.miniatura && (
                    <img
                      src={video.miniatura}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="aspect-video w-full object-cover"
                    />
                  )}
                  <span className="block truncate px-2 py-1.5 text-xs text-dex-ink/90">
                    {video.titulo}
                  </span>
                  {typeof video.vistas === "number" && (
                    <span className="block px-2 pb-1.5 text-[0.7rem] text-dex-muted">
                      {t("directo.vistas", { n: n(video.vistas) })}
                    </span>
                  )}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default DirectoEnVivo;
