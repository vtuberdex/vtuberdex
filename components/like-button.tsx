'use client';
/**
 * Botón de like de la ficha: uno por día y por VTuber, y cada like suma experiencia.
 *
 * El estado «ya diste like hoy» NO viaja en la ficha (que se cachea en el borde y es igual para
 * todos): se pide aparte al montar (`api.likeEstado`), porque depende de la cookie del visitante.
 * Mientras no se sabe el botón está deshabilitado en vez de parecer disponible y fallar al pulsar.
 */
import { useEffect, useState } from 'react';

import { ApiError, api, type LikeResumen } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

export function LikeButton({
  slug,
  likes,
  onChange,
}: {
  slug: string;
  /** Total que trajo la ficha: se muestra de inmediato, antes de saber el estado del visitante. */
  likes: number;
  /** Tras cambiar (like dado o estado leído) el padre actualiza nivel y barra de experiencia. */
  onChange?: (resumen: LikeResumen) => void;
}) {
  const { t } = useI18n();
  const [total, setTotal] = useState(likes);
  const [liked, setLiked] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [xp, setXp] = useState<number | null>(null);

  useEffect(() => setTotal(likes), [likes]);

  useEffect(() => {
    const controller = new AbortController();
    api
      .likeEstado(slug, controller.signal)
      .then((resumen) => {
        setLiked(resumen.liked);
        setTotal(resumen.likes);
        setXp(resumen.xpPorLike);
        onChange?.(resumen);
      })
      // Sin estado fiable el botón queda deshabilitado con su motivo: mejor eso que dejar votar a ciegas.
      .catch(() => {
        if (!controller.signal.aborted) setMensaje(t('like.noDisponible'));
      });
    return () => controller.abort();
    // `onChange` cambia de identidad en cada render del padre: no debe reiniciar la consulta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const dar = async () => {
    setBusy(true);
    setMensaje(null);
    try {
      const resumen = await api.darLike(slug);
      setLiked(true);
      setTotal(resumen.likes);
      setXp(resumen.xpPorLike);
      setMensaje(t('like.gracias', { xp: resumen.xpPorLike }));
      onChange?.(resumen);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) setLiked(true);
      setMensaje(cause instanceof Error ? cause.message : t('like.fallo'));
    } finally {
      setBusy(false);
    }
  };

  const disabled = busy || liked !== false;
  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="like-box">
      <button
        type="button"
        onClick={dar}
        disabled={disabled}
        aria-pressed={liked === true}
        data-testid="like-button"
        className={`inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-bold transition-colors disabled:cursor-not-allowed ${
          liked
            ? 'border-rose-400/60 bg-rose-500/20 text-rose-200'
            : 'border-dex-line bg-dex-panel text-dex-ink hover:border-rose-400/60 hover:text-rose-200 disabled:opacity-60'
        }`}
      >
        <span aria-hidden className="text-base leading-none">
          {liked ? '♥' : '♡'}
        </span>
        <span>{liked ? t('like.dado') : t('like.dar')}</span>
        <span data-testid="like-count" className="rounded-md bg-black/30 px-1.5 font-mono text-xs">
          {total}
        </span>
      </button>
      <p role="status" className="text-xs text-dex-muted" data-testid="like-message">
        {mensaje ?? (liked === false ? t('like.ayuda', { xp: xp ?? 10 }) : liked ? t('like.manana') : '')}
      </p>
    </div>
  );
}

export default LikeButton;
