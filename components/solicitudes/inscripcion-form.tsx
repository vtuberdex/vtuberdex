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

const SIGNOS = ['Aries', 'Tauro', 'Géminis', 'Cáncer', 'Leo', 'Virgo', 'Libra', 'Escorpio', 'Sagitario', 'Capricornio', 'Acuario', 'Piscis'];

/**
 * Los datos de la 2.ª página que son TEXTO corto y obligatorios. Una sola lista alimenta el estado, el
 * render y el envío: añadir uno es una línea aquí (y su campo en `inscripcionSchema` del servidor).
 */
const CAMPOS_PERFIL = [
  // Paso 2: tu personaje (lo que más se quiere contar, con la cabeza fresca).
  { paso: 2, clave: 'modeler', etiqueta: 'Modelo (quién lo hizo)', ejemplo: 'Nombre de quien hizo tu modelo', max: 80 },
  { paso: 2, clave: 'hashtag', etiqueta: 'Hashtag de arte', ejemplo: '#MiHashtag', max: 120 },
  { paso: 2, clave: 'height', etiqueta: 'Estatura', ejemplo: '1,60 m', max: 40 },
  { paso: 2, clave: 'birthday', etiqueta: 'Cumpleaños', ejemplo: '12 de marzo', max: 80 },
  // Paso 3: gustos. Respuestas de una palabra, por eso van al final y juntas.
  { paso: 3, clave: 'favoriteFood', etiqueta: 'Comida favorita', ejemplo: '', max: 120 },
  { paso: 3, clave: 'dislikedFood', etiqueta: 'Comida que te desagrada', ejemplo: '', max: 120 },
  { paso: 3, clave: 'favoriteGame', etiqueta: 'Videojuego favorito', ejemplo: '', max: 120 },
  { paso: 3, clave: 'favoriteSeries', etiqueta: 'Serie favorita', ejemplo: '', max: 120 },
  { paso: 3, clave: 'favoriteMusic', etiqueta: 'Música favorita', ejemplo: '', max: 120 },
  { paso: 3, clave: 'favoriteAnime', etiqueta: 'Anime favorito', ejemplo: '', max: 120 },
  { paso: 3, clave: 'favoriteAnimal', etiqueta: 'Animal favorito', ejemplo: '', max: 120 },
  { paso: 3, clave: 'favoriteColor', etiqueta: 'Color favorito', ejemplo: '', max: 80 },
] as const;

const TITULOS_PASO = { 1: 'Lo básico y tu contacto', 2: 'Tu personaje', 3: 'Tus gustos' } as const;
type Paso = 1 | 2 | 3;
type ClavePerfil = (typeof CAMPOS_PERFIL)[number]['clave'];

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
  const [paso, setPaso] = useState<Paso>(1);
  const [perfil, setPerfil] = useState<Record<ClavePerfil, string>>(() =>
    Object.fromEntries(CAMPOS_PERFIL.map((c) => [c.clave, ''])) as Record<ClavePerfil, string>,
  );
  const [zodiac, setZodiac] = useState('');
  const [cardText, setCardText] = useState('');
  const [themeColor, setThemeColor] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
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
    // La validación nativa (`required`) de la página 1 corre antes de este `submit`: si llegamos aquí
    // los datos de este paso están completos y solo falta pasar al siguiente.
    if (paso < 3) {
      setPaso((paso + 1) as Paso);
      window.scrollTo({ top: 0 });
      return;
    }
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
        logoUrl,
        zodiac,
        ...perfil,
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

  const camposDelPaso = (n: Paso) =>
    CAMPOS_PERFIL.filter((c) => c.paso === n).map((campo) => (
      <Campo key={campo.clave} etiqueta={campo.etiqueta} obligatorio>
        <input
          className={claseInput}
          required
          maxLength={campo.max}
          placeholder={campo.ejemplo}
          value={perfil[campo.clave]}
          onChange={(e) => setPerfil((actual) => ({ ...actual, [campo.clave]: e.target.value }))}
        />
      </Campo>
    ));

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
      <div>
        <p className="text-xs uppercase tracking-[0.14em] text-dex-muted" data-testid="inscripcion-paso" aria-live="polite">
          Paso {paso} de 3 · {TITULOS_PASO[paso]}
        </p>
        <div className="mt-2 flex gap-1.5" aria-hidden>
          {[1, 2, 3].map((n) => (
            <span key={n} className={`h-1 flex-1 rounded-full ${n <= paso ? 'bg-dex-accent' : 'bg-dex-line'}`} />
          ))}
        </div>
      </div>

      {paso === 1 && (
        <>
      <fieldset className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/70 p-5">
        <legend className="px-2 text-sm font-bold text-dex-ink">Tu ficha (datos públicos)</legend>
        <Campo etiqueta="Nombre artístico" obligatorio>
          <input className={claseInput} required maxLength={160} value={name} onChange={(e) => setName(e.target.value)} />
        </Campo>
        <Campo etiqueta="Color de marca" ayuda="Opcional. Tiñe tu carta.">
          <input
            type="color"
            aria-label="Color de marca"
            className="mt-1 h-10 w-full cursor-pointer rounded-lg border border-dex-line bg-dex-void p-1 sm:w-48"
            value={themeColor || '#5eead4'}
            onChange={(e) => setThemeColor(e.target.value)}
          />
        </Campo>
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

        </>
      )}

      {paso === 2 && (
        <>
          <fieldset className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/70 p-5" data-testid="inscripcion-paso-2">
            <legend className="px-2 text-sm font-bold text-dex-ink">Imágenes (enlaces)</legend>
            <p className="text-xs text-dex-muted">
              Pega un enlace (Drive, Imgur, tu sitio…): el formulario no recibe archivos. El arte debe ser tuyo o contar con permiso de su autoría.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo etiqueta="Avatar" obligatorio ayuda="Tu personaje completo: la imagen de la carta.">
                <input type="url" className={claseInput} required maxLength={500} placeholder="https://" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
              </Campo>
              <Campo etiqueta="Logo" obligatorio>
                <input type="url" className={claseInput} required maxLength={500} placeholder="https://" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} />
              </Campo>
            </div>
          </fieldset>

          <fieldset className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/70 p-5">
            <legend className="px-2 text-sm font-bold text-dex-ink">Tu personaje</legend>
            <p className="text-xs text-dex-muted">
              Los campos con <span className="text-rose-300">*</span> son obligatorios. Todo esto se publica en tu ficha si el mantenedor la aprueba.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {camposDelPaso(2)}
              <Campo etiqueta="País">
                {paises.length ? (
                  <select className={claseInput} value={country} onChange={(e) => setCountry(e.target.value)}>
                    <option value="">Elige…</option>
                    {paises.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input className={claseInput} maxLength={60} value={country} onChange={(e) => setCountry(e.target.value)} />
                )}
              </Campo>
              <Campo etiqueta="Signo">
                <select className={claseInput} value={zodiac} onChange={(e) => setZodiac(e.target.value)}>
                  <option value="">Elige…</option>
                  {SIGNOS.map((signo) => (
                    <option key={signo} value={signo}>
                      {signo}
                    </option>
                  ))}
                </select>
              </Campo>
            </div>
            <Campo etiqueta="Lore" obligatorio ayuda="Tu historia. Aparece en tu carta. No incluyas datos personales: este campo es público.">
              <textarea className={`${claseInput} min-h-28`} required maxLength={4000} value={cardText} onChange={(e) => setCardText(e.target.value)} />
            </Campo>
          </fieldset>
        </>
      )}

      {paso === 3 && (
        <>
          <fieldset className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/70 p-5" data-testid="inscripcion-paso-3">
            <legend className="px-2 text-sm font-bold text-dex-ink">Tus gustos</legend>
            <p className="text-xs text-dex-muted">Último paso: respuestas cortas, una línea basta. Todos son obligatorios.</p>
            <div className="grid gap-4 sm:grid-cols-2">{camposDelPaso(3)}</div>
          </fieldset>

          <CampoTrampa valor={website} alCambiar={setWebsite} />
          <AceptaTerminos idUnico="acepta-terminos-inscripcion" marcada={acepta} alCambiar={setAcepta} />
        </>
      )}

      {error && <Aviso tipo="error">{error}</Aviso>}
      <div className="flex flex-wrap items-center gap-4">
        {paso > 1 && (
          <button type="button" className="rounded-xl border border-dex-line px-5 py-2.5 text-sm text-dex-muted hover:text-dex-ink" onClick={() => setPaso((paso - 1) as Paso)}>
            ← Volver
          </button>
        )}
        <button type="submit" className={claseBoton} disabled={enviando || (paso === 3 && !acepta)}>
          {paso < 3 ? 'Siguiente →' : enviando ? 'Enviando…' : 'Enviar inscripción'}
        </button>
        {paso === 3 && <span className="text-xs text-dex-muted">Quedará en espera hasta que el mantenedor la revise.</span>}
      </div>
    </form>
  );
}
