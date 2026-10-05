'use client';
/**
 * Voz de la ficha: al entrar, una voz sintética «de aparato» lee el nombre y la historia, y un
 * parlantito la silencia. El clip lo sirve `/voces/<slug>.mp3`; si la ficha no tiene, el botón
 * no se muestra.
 *
 * Reglas que importan:
 *   · El mute es UNA preferencia global (localStorage), no una por ficha: quien la silencia una
 *     vez no quiere oírla en las 785. Si el almacenamiento falla (modo privado), se asume «con voz».
 *   · El navegador puede bloquear la reproducción automática (p. ej. un enlace directo a la
 *     ficha, sin gesto previo). Entrando desde el catálogo hay un clic, así que normalmente suena;
 *     si se bloquea, el botón queda en «Escuchar» y el clic la inicia. Nunca falla en silencio.
 *   · Al salir de la ficha el audio se detiene (el componente se desmonta), para que no se
 *     solape con la voz de la siguiente.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { useI18n } from '@/lib/i18n';

export const CLAVE_SILENCIO = 'vtuberdex:voz-silenciada';

function leerSilencio(): boolean {
  try {
    return window.localStorage.getItem(CLAVE_SILENCIO) === '1';
  } catch {
    return false;
  }
}

function guardarSilencio(silenciada: boolean): void {
  try {
    window.localStorage.setItem(CLAVE_SILENCIO, silenciada ? '1' : '0');
  } catch {
    /* sin almacenamiento: la preferencia vale solo para esta visita */
  }
}

/** `flotante`: píldora translúcida para ir SOBRE la carta (se lee sobre cualquier fondo). */
const ESTILO_NORMAL =
  'rounded-lg border border-dex-line bg-dex-panel px-3 py-1.5 text-xs text-dex-muted hover:border-dex-accent/60 hover:text-dex-ink';
const ESTILO_FLOTANTE =
  'rounded-full border border-white/20 bg-black/55 px-3 py-1.5 text-xs text-white/85 shadow-lg backdrop-blur hover:border-dex-accent/70 hover:text-white';

export function VoiceButton({ slug, flotante = false }: { slug: string; flotante?: boolean }) {
  const { t } = useI18n();
  const audio = useRef<HTMLAudioElement>(null);
  const [disponible, setDisponible] = useState(false);
  const [silenciada, setSilenciada] = useState(false);
  const [sonando, setSonando] = useState(false);

  useEffect(() => {
    let vivo = true;
    setSilenciada(leerSilencio());
    fetch(`/voces/${slug}.mp3`, { method: 'HEAD' })
      .then((respuesta) => vivo && setDisponible(respuesta.ok))
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [slug]);

  const reproducir = useCallback(() => {
    const el = audio.current;
    if (!el) return;
    el.currentTime = 0;
    void el.play().catch(() => setSonando(false));
  }, []);

  // Al tener clip y no estar silenciada, suena sola; al salir, se corta.
  useEffect(() => {
    const el = audio.current;
    if (!disponible || !el) return;
    if (!silenciada) reproducir();
    return () => {
      el.pause();
    };
  }, [disponible, silenciada, reproducir]);

  if (!disponible) return null;

  const alPulsar = () => {
    if (sonando) {
      audio.current?.pause();
      if (audio.current) audio.current.currentTime = 0;
      setSonando(false);
      setSilenciada(true);
      guardarSilencio(true);
      return;
    }
    guardarSilencio(false);
    if (silenciada) setSilenciada(false); // el efecto la reproduce
    else reproducir();
  };

  return (
    <>
      <audio
        ref={audio}
        src={`/voces/${slug}.mp3`}
        preload="auto"
        onPlay={() => setSonando(true)}
        onPause={() => setSonando(false)}
        onEnded={() => setSonando(false)}
        data-testid="voz-audio"
      />
      <button
        type="button"
        onClick={alPulsar}
        aria-label={sonando ? t('voz.silenciarEtiqueta') : t('voz.escucharEtiqueta')}
        aria-pressed={silenciada}
        data-testid="voz-boton"
        className={`inline-flex items-center gap-2 transition-colors ${flotante ? ESTILO_FLOTANTE : ESTILO_NORMAL}`}
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" />
          {silenciada || !sonando ? (
            silenciada ? (
              <path d="m17 9 5 6m0-6-5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            ) : (
              <path d="M16 9.5a4 4 0 0 1 0 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
            )
          ) : (
            <>
              <path d="M16 9a4.5 4.5 0 0 1 0 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M18.5 6.5a8 8 0 0 1 0 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </>
          )}
        </svg>
        {sonando ? t('voz.silenciar') : silenciada ? t('voz.silenciada') : t('voz.escuchar')}
      </button>
    </>
  );
}

export default VoiceButton;
