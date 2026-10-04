'use client';
/**
 * Formulario PÚBLICO de inscripción de una ficha.
 *
 * No publica nada: deja una solicitud en espera que el mantenedor revisa. Por eso el mensaje final
 * dice «recibida», no «creada». El correo y el nombre civil se marcan como confidenciales (nunca
 * viajan a la ficha: ver `server/src/solicitudes.mjs`). El arte del personaje se pide como
 * ENLACE y no como archivo: un formulario público que recibe archivos es una puerta abierta a
 * subir basura al almacenamiento; el mantenedor lo descarga y lo sube por su gestor de imágenes.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { ApiError, api } from '@/lib/api';
import { DEFAULT_SEARCH } from '@/lib/query';
import { facetValue } from '@/lib/types';
import { TERMINOS_VERSION } from '@/lib/terminos';
import { AceptaTerminos, Aviso, Campo, CampoTrampa, claseBoton, claseInput } from '@/components/solicitudes/campos';

interface Opcion {
  value: string;
  label: string;
}

/** Respaldo si las facetas no llegan: el formulario sigue siendo utilizable. */
const IDIOMAS_RESPALDO: Opcion[] = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'Inglés' },
  { value: 'pt', label: 'Portugués' },
];

const MAX_REDES = 10;

interface Red {
  platform: string;
  url: string;
}

export function InscripcionForm() {
  const [paises, setPaises] = useState<Opcion[]>([]);
  const [idiomas, setIdiomas] = useState<Opcion[]>(IDIOMAS_RESPALDO);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [realName, setRealName] = useState('');
  const [country, setCountry] = useState('');
  const [languages, setLanguages] = useState<string[]>([]);
  const [phrase, setPhrase] = useState('');
  const [cardText, setCardText] = useState('');
  const [themeColor, setThemeColor] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [socials, setSocials] = useState<Red[]>([{ platform: '', url: '' }]);
  const [acepta, setAcepta] = useState(false);
  const [website, setWebsite] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviada, setEnviada] = useState(false);

  useEffect(() => {
    api
      .list({ ...DEFAULT_SEARCH, perPage: 1 })
      .then((respuesta) => {
        setPaises((respuesta.facets?.countries ?? []).map((b) => ({ value: facetValue(b), label: b.name })));
        const delServidor = (respuesta.facets?.languages ?? []).map((b) => ({ value: facetValue(b), label: b.name }));
        if (delServidor.length) setIdiomas(delServidor);
      })
      .catch(() => undefined);
  }, []);

  const cambiarRed = (indice: number, cambio: Partial<Red>) =>
    setSocials((actuales) => actuales.map((r, i) => (i === indice ? { ...r, ...cambio } : r)));

  const alternarIdioma = (codigo: string) =>
    setLanguages((actuales) => (actuales.includes(codigo) ? actuales.filter((c) => c !== codigo) : [...actuales, codigo]));

  const enviar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setError(null);
    if (!acepta) {
      setError('Debes aceptar los términos y condiciones para enviar la inscripción.');
      return;
    }
    setEnviando(true);
    try {
      await api.enviarInscripcion({
        name,
        email,
        realName,
        country,
        languages,
        phrase,
        cardText,
        themeColor,
        imageUrl,
        socials: socials.filter((r) => r.platform.trim() || r.url.trim()),
        aceptaTerminos: true,
        terminosVersion: TERMINOS_VERSION,
        website,
      });
      setEnviada(true);
    } catch (causa) {
      setError(causa instanceof ApiError ? causa.message : 'No se pudo enviar la inscripción. Inténtalo de nuevo.');
    } finally {
      setEnviando(false);
    }
  };

  if (enviada) {
    return (
      <div className="space-y-4" data-testid="inscripcion-enviada">
        <Aviso tipo="ok">
          <strong>Inscripción recibida.</strong> Quedó en espera de revisión: todavía no es una ficha publicada. El mantenedor la revisará y,
          si la aprueba, se creará tu ficha en borrador. No hay plazo garantizado de respuesta.
        </Aviso>
        <Link href="/" className="inline-block text-sm text-dex-accent underline underline-offset-2">
          Volver al catálogo
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="relative space-y-6" data-testid="inscripcion-form" noValidate={false}>
      <fieldset className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/70 p-5">
        <legend className="px-2 text-sm font-bold text-dex-ink">Tu ficha (datos públicos)</legend>
        <Campo etiqueta="Nombre artístico" obligatorio>
          <input className={claseInput} required maxLength={160} value={name} onChange={(e) => setName(e.target.value)} />
        </Campo>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="País" obligatorio>
            {paises.length ? (
              <select className={claseInput} required value={country} onChange={(e) => setCountry(e.target.value)}>
                <option value="">Elige…</option>
                {paises.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            ) : (
              <input className={claseInput} required maxLength={60} value={country} onChange={(e) => setCountry(e.target.value)} />
            )}
          </Campo>
          <Campo etiqueta="Color de marca" ayuda="Opcional. Tiñe tu carta.">
            <input
              type="color"
              aria-label="Color de marca"
              className="mt-1 h-10 w-full cursor-pointer rounded-lg border border-dex-line bg-dex-void p-1"
              value={themeColor || '#5eead4'}
              onChange={(e) => setThemeColor(e.target.value)}
            />
          </Campo>
        </div>
        <fieldset>
          <legend className="text-xs uppercase tracking-[0.14em] text-dex-muted">
            Idiomas <span className="text-rose-300" aria-hidden>*</span>
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {idiomas.map((idioma) => (
              <label
                key={idioma.value}
                className={`cursor-pointer rounded-full border px-3 py-1 text-xs ${
                  languages.includes(idioma.value) ? 'border-dex-accent bg-dex-accent/15 text-dex-ink' : 'border-dex-line text-dex-muted'
                }`}
              >
                <input type="checkbox" className="sr-only" checked={languages.includes(idioma.value)} onChange={() => alternarIdioma(idioma.value)} />
                {idioma.label}
              </label>
            ))}
          </div>
        </fieldset>
        <Campo etiqueta="Frase" ayuda="Una línea que te presente (máx. 600 caracteres).">
          <input className={claseInput} maxLength={600} value={phrase} onChange={(e) => setPhrase(e.target.value)} />
        </Campo>
        <Campo etiqueta="Descripción / historia" ayuda="Aparece en tu carta. No incluyas datos personales aquí: este campo es público.">
          <textarea className={`${claseInput} min-h-28`} maxLength={4000} value={cardText} onChange={(e) => setCardText(e.target.value)} />
        </Campo>
        <Campo etiqueta="Enlace al arte de tu personaje" ayuda="Una URL (Drive, Imgur, tu sitio…). El arte debe ser tuyo o contar con permiso de su autoría.">
          <input type="url" className={claseInput} maxLength={500} placeholder="https://" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
        </Campo>
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-dex-muted">
            Redes y canales <span className="text-rose-300" aria-hidden>*</span>
          </p>
          <div className="mt-2 space-y-2">
            {socials.map((red, indice) => (
              <div key={indice} className="grid grid-cols-[8rem_1fr_auto] gap-2">
                <input
                  aria-label={`Plataforma ${indice + 1}`}
                  className={`${claseInput} mt-0`}
                  placeholder="Twitch, YouTube…"
                  maxLength={40}
                  value={red.platform}
                  onChange={(e) => cambiarRed(indice, { platform: e.target.value })}
                />
                <input
                  aria-label={`Enlace ${indice + 1}`}
                  type="url"
                  className={`${claseInput} mt-0`}
                  placeholder="https://"
                  maxLength={500}
                  value={red.url}
                  onChange={(e) => cambiarRed(indice, { url: e.target.value })}
                />
                <button
                  type="button"
                  className="rounded-lg border border-dex-line px-2 text-xs text-dex-muted hover:text-dex-ink disabled:opacity-40"
                  disabled={socials.length === 1}
                  onClick={() => setSocials((actuales) => actuales.filter((_, i) => i !== indice))}
                  aria-label={`Quitar enlace ${indice + 1}`}
                >
                  Quitar
                </button>
              </div>
            ))}
          </div>
          {socials.length < MAX_REDES && (
            <button
              type="button"
              className="mt-2 text-xs text-dex-accent underline underline-offset-2"
              onClick={() => setSocials((actuales) => [...actuales, { platform: '', url: '' }])}
            >
              + Añadir otra red
            </button>
          )}
        </div>
      </fieldset>

      <fieldset className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/70 p-5">
        <legend className="px-2 text-sm font-bold text-dex-ink">Contacto (confidencial)</legend>
        <p className="text-xs text-dex-muted">
          Estos datos no se publican, no van a tu ficha ni a la API pública. Solo los ve el mantenedor para responderte. Detalle en la{' '}
          <Link href="/terminos#datos-personales" target="_blank" rel="noopener" className="text-dex-accent underline underline-offset-2">
            cláusula de datos personales
          </Link>
          .
        </p>
        <Campo etiqueta="Correo electrónico" obligatorio confidencial>
          <input type="email" className={claseInput} required maxLength={200} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Campo>
        <Campo etiqueta="Nombre civil" confidencial ayuda="Opcional.">
          <input className={claseInput} maxLength={160} autoComplete="name" value={realName} onChange={(e) => setRealName(e.target.value)} />
        </Campo>
      </fieldset>

      <CampoTrampa valor={website} alCambiar={setWebsite} />
      <AceptaTerminos idUnico="acepta-terminos-inscripcion" marcada={acepta} alCambiar={setAcepta} />

      {error && <Aviso tipo="error">{error}</Aviso>}
      <div className="flex items-center gap-4">
        <button type="submit" className={claseBoton} disabled={enviando || !acepta}>
          {enviando ? 'Enviando…' : 'Enviar inscripción'}
        </button>
        <span className="text-xs text-dex-muted">Quedará en espera hasta que el mantenedor la revise.</span>
      </div>
    </form>
  );
}
