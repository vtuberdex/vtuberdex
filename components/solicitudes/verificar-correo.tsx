'use client';

/**
 * Pantalla a la que llega el enlace del correo (`/verificar#t=<token>`).
 *
 * El token viaja en el FRAGMENTO: no llega al servidor ni a sus logs. Y no se gasta al abrir la
 * página sino al pulsar el botón: los clientes de correo y los antivirus abren los enlaces para
 * inspeccionarlos, y un GET que consumiera el token lo quemaría antes de que la persona llegue.
 * El fragmento se lee en un efecto (en el servidor no hay `window`) y se borra de la barra.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { ApiError, api, type ResultadoDeVerificacion } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

import { Aviso } from './campos';

const TIPOS = {
  inscripcion: 'verificar.tipo.inscripcion',
  baja: 'verificar.tipo.baja',
  modificacion: 'verificar.tipo.modificacion',
} as const;

/** Qué pasó al confirmar el correo. Lo comparten esta página (enlace) y el paso 2 del formulario de baja (código). */
export function ResultadoDeLaVerificacion({ resultado }: { resultado: ResultadoDeVerificacion }) {
  const { t } = useI18n();
  return (
    <div className="space-y-4" data-testid="verificar-hecho">
      <Aviso tipo="ok">
        {resultado.resultado === 'baja_aplicada' ? (
          <>
            <strong>{t('verificar.bajaAplicada')}</strong>{' '}
            {t('verificar.bajaTexto', { n: resultado.fichas?.length ?? 0, fichas: resultado.fichas?.join(', ') ?? '' })}
          </>
        ) : resultado.resultado === 'sin_ficha' ? (
          <>
            <strong>{t('verificar.confirmado')}</strong> {t('verificar.sinFicha')}
          </>
        ) : (
          <>
            <strong>{t('verificar.confirmado')}</strong> {t('verificar.enEspera', { tipo: t(TIPOS[resultado.tipo]) })}
            {resultado.tipo === 'baja' && ` ${t('verificar.bajaRevision')}`}
          </>
        )}
      </Aviso>
      <Link href="/" className="inline-block text-sm text-dex-accent underline underline-offset-2">
        {t('verificar.volver')}
      </Link>
    </div>
  );
}

export function VerificarCorreo() {
  const { t } = useI18n();
  const [token, setToken] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<ResultadoDeVerificacion | null>(null);

  useEffect(() => {
    const encontrado = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('t');
    setToken(encontrado);
    setListo(true);
    if (encontrado) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  const confirmar = async () => {
    if (!token) return;
    setEnviando(true);
    setError(null);
    try {
      const respuesta = await api.verificarSolicitud(token);
      setHecho(respuesta);
    } catch (causa) {
      setError(causa instanceof ApiError ? causa.message : t('verificar.errorConfirmar'));
    } finally {
      setEnviando(false);
    }
  };

  if (hecho) return <ResultadoDeLaVerificacion resultado={hecho} />;

  if (listo && !token) {
    return (
      <div className="space-y-4" data-testid="verificar-sin-token">
        <Aviso tipo="error">
          {t('verificar.incompleto')}
        </Aviso>
        <Link href="/" className="inline-block text-sm text-dex-accent underline underline-offset-2">
          {t('verificar.volver')}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="verificar-pendiente">
      {error && <Aviso tipo="error">{error}</Aviso>}
      <button
        type="button"
        onClick={confirmar}
        disabled={!token || enviando}
        className="rounded-xl bg-dex-accent px-5 py-2.5 text-sm font-bold text-black disabled:opacity-50"
      >
        {enviando ? t('verificar.confirmando') : t('verificar.confirmarBoton')}
      </button>
    </div>
  );
}
