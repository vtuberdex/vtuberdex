'use client';
/**
 * Formulario PÚBLICO de baja, en DOS pasos y sin pedir la ficha ni «cómo comprobamos»:
 *
 *   1. Correo y motivo (más los términos). El servidor manda un código de un solo uso a ese correo.
 *   2. La persona pega el código (o abre el enlace del correo) y la baja se confirma.
 *
 * La titularidad la prueba el correo: la ficha es la de la inscripción aprobada con esa dirección, así
 * que no hace falta escribirla. El campo «Ficha» queda como OPCIONAL, escondido, para quien nunca se
 * inscribió con ese correo (las fichas del scrape original no tienen uno guardado) o tiene varias.
 *
 * Dice con todas las letras, antes de enviar, lo que implica la cláusula de salida (la ficha no se
 * elimina, se degrada): hay que enterarse ANTES, no al ver la ficha deteriorada. Y no revela nada de
 * lo asociado al correo hasta que se demuestra que es de quien lo escribe.
 */
import Link from 'next/link';
import { useState } from 'react';

import { ApiError, api, type ResultadoDeVerificacion } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { TERMINOS_VERSION } from '@/lib/terminos';
import { AceptaTerminos, Aviso, Campo, CampoTrampa, claseBoton, claseInput } from '@/components/solicitudes/campos';
import { ResultadoDeLaVerificacion } from '@/components/solicitudes/verificar-correo';

export function BajaForm() {
  const { t } = useI18n();
  const [paso, setPaso] = useState<1 | 2>(1);
  const [ficha, setFicha] = useState('');
  const [email, setEmail] = useState('');
  const [motivo, setMotivo] = useState('');
  const [acepta, setAcepta] = useState(false);
  const [website, setWebsite] = useState('');
  const [codigo, setCodigo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoDeVerificacion | null>(null);

  const pedirCodigo = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setError(null);
    if (!acepta) {
      setError(t('baja.errorTerminos'));
      return;
    }
    setEnviando(true);
    try {
      await api.enviarBaja({ ficha, email, motivo, aceptaTerminos: true, terminosVersion: TERMINOS_VERSION, website });
      setPaso(2);
    } catch (causa) {
      setError(causa instanceof ApiError ? causa.message : t('baja.errorEnviar'));
    } finally {
      setEnviando(false);
    }
  };

  const confirmar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      setResultado(await api.verificarSolicitud(codigo.trim()));
    } catch (causa) {
      setError(causa instanceof ApiError ? causa.message : t('baja.errorConfirmar'));
    } finally {
      setEnviando(false);
    }
  };

  if (resultado) return <ResultadoDeLaVerificacion resultado={resultado} />;

  if (paso === 2) {
    return (
      <form onSubmit={confirmar} className="space-y-6" data-testid="baja-paso-2">
        <Aviso tipo="ok">
          <strong>{t('baja.revisaCorreo')}</strong> {t('baja.codigoEnviadoA')} <strong>{email}</strong>. {t('baja.codigoInstrucciones')}
        </Aviso>
        <fieldset className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/70 p-5">
          <legend className="px-2 text-sm font-bold text-dex-ink">{t('baja.paso2')}</legend>
          <Campo etiqueta={t('baja.codigo')} obligatorio>
            <input
              className={`${claseInput} font-mono`}
              required
              minLength={20}
              maxLength={100}
              autoComplete="one-time-code"
              spellCheck={false}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
            />
          </Campo>
        </fieldset>
        {error && <Aviso tipo="error">{error}</Aviso>}
        <div className="flex flex-wrap items-center gap-4">
          <button type="submit" className={claseBoton} disabled={enviando || !codigo.trim()}>
            {enviando ? t('baja.confirmando') : t('baja.confirmar')}
          </button>
          <button
            type="button"
            className="text-sm text-dex-muted underline underline-offset-2 hover:text-dex-ink"
            onClick={() => {
              setPaso(1);
              setCodigo('');
              setError(null);
            }}
          >
            {t('baja.volver')}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={pedirCodigo} className="relative space-y-6" data-testid="baja-form">
      <div className="rounded-2xl border border-amber-300/40 bg-amber-300/10 p-5 text-sm text-amber-100" data-testid="baja-aviso-salida">
        <p className="font-bold">{t('baja.avisoTitulo')}</p>
        <p className="mt-2">
          {t('baja.avisoNoElimina')} <strong>{t('baja.avisoNoEliminaFuerte')}</strong>
          {t('baja.avisoTexto')}{' '}
          <Link href="/terminos#salida" target="_blank" rel="noopener" className="underline underline-offset-2">
            {t('form.terminosSalida')}
          </Link>
          .
        </p>
      </div>

      <fieldset className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/70 p-5">
        <legend className="px-2 text-sm font-bold text-dex-ink">{t('baja.paso1')}</legend>
        <Campo
          etiqueta={t('baja.correo')}
          obligatorio
          confidencial
          ayuda={t('baja.correoAyuda')}
        >
          <input type="email" className={claseInput} required maxLength={200} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Campo>
        <Campo etiqueta={t('baja.motivo')} ayuda={t('baja.motivoAyuda')}>
          <textarea className={`${claseInput} min-h-20`} maxLength={2000} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </Campo>
        <details className="text-sm text-dex-muted">
          <summary className="cursor-pointer hover:text-dex-ink">{t('baja.otroCorreo')}</summary>
          <div className="mt-3">
            <Campo etiqueta={t('baja.ficha')} ayuda={t('baja.fichaAyuda')}>
              <input className={claseInput} maxLength={300} value={ficha} onChange={(e) => setFicha(e.target.value)} />
            </Campo>
          </div>
        </details>
      </fieldset>

      <CampoTrampa valor={website} alCambiar={setWebsite} />
      <AceptaTerminos idUnico="acepta-terminos-baja" marcada={acepta} alCambiar={setAcepta} />

      {error && <Aviso tipo="error">{error}</Aviso>}
      <div className="flex items-center gap-4">
        <button type="submit" className={claseBoton} disabled={enviando || !acepta}>
          {enviando ? t('baja.enviando') : t('baja.enviarCodigo')}
        </button>
      </div>
    </form>
  );
}
