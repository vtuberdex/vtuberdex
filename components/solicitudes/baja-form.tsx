'use client';
/**
 * Formulario PÚBLICO de baja. Exige los mismos términos que la inscripción.
 *
 * Lo que NO hace es borrar nada: deja una solicitud en espera. Y dice con todas las letras, en el
 * propio formulario, lo que implica según la cláusula de salida (la ficha no se elimina, se
 * degrada): quien pide la baja tiene que enterarse ANTES de enviar, no al ver su ficha deteriorada.
 */
import Link from 'next/link';
import { useState } from 'react';

import { ApiError, api } from '@/lib/api';
import { TERMINOS_VERSION } from '@/lib/terminos';
import { AceptaTerminos, Aviso, Campo, CampoTrampa, claseBoton, claseInput } from '@/components/solicitudes/campos';

export function BajaForm() {
  const [ficha, setFicha] = useState('');
  const [email, setEmail] = useState('');
  const [prueba, setPrueba] = useState('');
  const [motivo, setMotivo] = useState('');
  const [acepta, setAcepta] = useState(false);
  const [website, setWebsite] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviada, setEnviada] = useState(false);

  const enviar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setError(null);
    if (!acepta) {
      setError('Debes aceptar los términos y condiciones para solicitar la baja.');
      return;
    }
    setEnviando(true);
    try {
      await api.enviarBaja({ ficha, email, prueba, motivo, aceptaTerminos: true, terminosVersion: TERMINOS_VERSION, website });
      setEnviada(true);
    } catch (causa) {
      setError(causa instanceof ApiError ? causa.message : 'No se pudo enviar la solicitud. Inténtalo de nuevo.');
    } finally {
      setEnviando(false);
    }
  };

  if (enviada) {
    return (
      <div className="space-y-4" data-testid="baja-enviada">
        <Aviso tipo="ok">
          <strong>Solicitud de baja recibida.</strong> Queda en espera: el mantenedor comprobará que eres el titular y la procesará. No hay
          plazo garantizado. Tu correo se elimina al procesarla.
        </Aviso>
        <Link href="/" className="inline-block text-sm text-dex-accent underline underline-offset-2">
          Volver al catálogo
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="relative space-y-6" data-testid="baja-form">
      <div className="rounded-2xl border border-amber-300/40 bg-amber-300/10 p-5 text-sm text-amber-100" data-testid="baja-aviso-salida">
        <p className="font-bold">Antes de continuar: qué pasa con tu ficha</p>
        <p className="mt-2">
          Darte de baja <strong>no elimina tu ficha</strong>. Permanece en el catálogo, pero sus datos se corrompen y se degradan de forma
          progresiva e irreversible (textos, imágenes, enlaces). Tus datos personales (correo, nombre civil) sí se eliminan. Está en la{' '}
          <Link href="/terminos#salida" target="_blank" rel="noopener" className="underline underline-offset-2">
            cláusula de salida
          </Link>
          .
        </p>
      </div>

      <fieldset className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/70 p-5">
        <legend className="px-2 text-sm font-bold text-dex-ink">Solicitud de baja</legend>
        <Campo etiqueta="Ficha" obligatorio ayuda="Su nombre o su dirección (por ejemplo /v/mi-nombre).">
          <input className={claseInput} required maxLength={300} value={ficha} onChange={(e) => setFicha(e.target.value)} />
        </Campo>
        <Campo etiqueta="Correo electrónico" obligatorio confidencial>
          <input type="email" className={claseInput} required maxLength={200} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Campo>
        <Campo
          etiqueta="Cómo comprobamos que eres el titular"
          obligatorio
          confidencial
          ayuda="Por ejemplo: un canal tuyo donde puedas dejar una marca que te indiquemos, o el correo con el que te inscribiste."
        >
          <textarea className={`${claseInput} min-h-20`} required minLength={5} maxLength={500} value={prueba} onChange={(e) => setPrueba(e.target.value)} />
        </Campo>
        <Campo etiqueta="Motivo" ayuda="Opcional.">
          <textarea className={`${claseInput} min-h-20`} maxLength={2000} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </Campo>
      </fieldset>

      <CampoTrampa valor={website} alCambiar={setWebsite} />
      <AceptaTerminos idUnico="acepta-terminos-baja" marcada={acepta} alCambiar={setAcepta} />

      {error && <Aviso tipo="error">{error}</Aviso>}
      <div className="flex items-center gap-4">
        <button type="submit" className={claseBoton} disabled={enviando || !acepta}>
          {enviando ? 'Enviando…' : 'Solicitar la baja'}
        </button>
        <span className="text-xs text-dex-muted">Queda en espera hasta que el mantenedor la revise.</span>
      </div>
    </form>
  );
}
