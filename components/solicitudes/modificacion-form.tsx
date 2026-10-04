'use client';
/**
 * Formulario PÚBLICO para pedir cambios en una ficha YA registrada.
 *
 * Es la inscripción sin lo que ya se sabe: no pide nombre ni obliga a rellenar nada de la ficha, solo
 * a identificarla (ficha + correo + cómo se comprueba que eres el titular, igual que la baja). Cada
 * campo en blanco significa «no cambia»; el servidor exige al menos un cambio. Nada se aplica solo:
 * queda en la misma cola de revisión, y el mantenedor aplica el parche al aprobar.
 *
 * Lleva los mismos tres pasos que la inscripción para que se sienta igual y cada pantalla sea corta;
 * las preguntas salen de la misma lista (`campos-ficha.ts`). El avatar y el logo se piden como ENLACE
 * (un formulario público que recibe archivos es una puerta a subir basura).
 */
import Link from 'next/link';
import { useState } from 'react';

import { ApiError, api } from '@/lib/api';
import { TERMINOS_VERSION } from '@/lib/terminos';
import { useOpcionesFicha } from '@/components/solicitudes/use-opciones-ficha';
import { CAMPOS_PERFIL, SIGNOS, type ClavePerfil } from '@/components/solicitudes/campos-ficha';
import { AceptaTerminos, Aviso, Campo, CampoTrampa, claseBoton, claseInput } from '@/components/solicitudes/campos';

const MAX_REDES = 10;

const TITULOS_PASO = { 1: 'Tu ficha', 2: 'Qué quieres cambiar', 3: 'Tus gustos y envío' } as const;
type Paso = 1 | 2 | 3;

interface Red {
  platform: string;
  url: string;
}

export function ModificacionForm() {
  const { paises, idiomas } = useOpcionesFicha();
  const [paso, setPaso] = useState<Paso>(1);
  const [ficha, setFicha] = useState('');
  const [email, setEmail] = useState('');
  const [prueba, setPrueba] = useState('');
  const [perfil, setPerfil] = useState<Record<ClavePerfil, string>>(() =>
    Object.fromEntries(CAMPOS_PERFIL.map((c) => [c.clave, ''])) as Record<ClavePerfil, string>,
  );
  const [country, setCountry] = useState('');
  const [zodiac, setZodiac] = useState('');
  const [languages, setLanguages] = useState<string[]>([]);
  const [phrase, setPhrase] = useState('');
  const [cardText, setCardText] = useState('');
  // El selector de color siempre tiene un valor: sin la casilla no se podría decir «no lo cambies».
  const [cambiaColor, setCambiaColor] = useState(false);
  const [themeColor, setThemeColor] = useState('#5eead4');
  const [imageUrl, setImageUrl] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [socials, setSocials] = useState<Red[]>([{ platform: '', url: '' }]);
  const [nota, setNota] = useState('');
  const [acepta, setAcepta] = useState(false);
  const [website, setWebsite] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviada, setEnviada] = useState(false);

  const cambiarRed = (indice: number, cambio: Partial<Red>) =>
    setSocials((actuales) => actuales.map((r, i) => (i === indice ? { ...r, ...cambio } : r)));
  const alternarIdioma = (codigo: string) =>
    setLanguages((actuales) => (actuales.includes(codigo) ? actuales.filter((c) => c !== codigo) : [...actuales, codigo]));

  const redes = socials.filter((r) => r.platform.trim() || r.url.trim());
  const hayCambios =
    [phrase, cardText, country, zodiac, imageUrl, logoUrl, ...Object.values(perfil)].some((v) => v.trim()) ||
    cambiaColor ||
    languages.length > 0 ||
    redes.length > 0;

  const enviar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setError(null);
    // La validación nativa (`required`) del paso corre antes de este `submit`.
    if (paso < 3) {
      setPaso((paso + 1) as Paso);
      window.scrollTo({ top: 0 });
      return;
    }
    if (!hayCambios) {
      setError('Indica al menos un cambio: vuelve al paso 2 y rellena lo que quieras modificar.');
      return;
    }
    if (!acepta) {
      setError('Debes aceptar los términos y condiciones para enviar la solicitud.');
      return;
    }
    setEnviando(true);
    try {
      await api.enviarModificacion({
        ficha,
        email,
        prueba,
        country,
        zodiac,
        languages,
        phrase,
        cardText,
        themeColor: cambiaColor ? themeColor : '',
        imageUrl,
        logoUrl,
        ...perfil,
        socials: redes,
        nota,
        aceptaTerminos: true,
        terminosVersion: TERMINOS_VERSION,
        website,
      });
      setEnviada(true);
    } catch (causa) {
      setError(causa instanceof ApiError ? causa.message : 'No se pudo enviar la solicitud. Inténtalo de nuevo.');
    } finally {
      setEnviando(false);
    }
  };

  const camposDelPaso = (n: Paso) =>
    CAMPOS_PERFIL.filter((c) => c.paso === n).map((campo) => (
      <Campo key={campo.clave} etiqueta={campo.etiqueta}>
        <input
          className={claseInput}
          maxLength={campo.max}
          placeholder={campo.ejemplo}
          value={perfil[campo.clave]}
          onChange={(e) => setPerfil((actual) => ({ ...actual, [campo.clave]: e.target.value }))}
        />
      </Campo>
    ));

  if (enviada) {
    return (
      <div className="space-y-4" data-testid="modificacion-enviada">
        <Aviso tipo="ok">
          <strong>Solicitud recibida.</strong> Quedó en espera de revisión: tu ficha todavía no cambió. El mantenedor comprobará que eres el
          titular y, si la aprueba, aplicará los cambios. No hay plazo garantizado de respuesta.
        </Aviso>
        <Link href="/" className="inline-block text-sm text-dex-accent underline underline-offset-2">
          Volver al catálogo
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="relative space-y-6" data-testid="modificacion-form">
      <div>
        <p className="text-xs uppercase tracking-[0.14em] text-dex-muted" data-testid="modificacion-paso" aria-live="polite">
          Paso {paso} de 3 · {TITULOS_PASO[paso]}
        </p>
        <div className="mt-2 flex gap-1.5" aria-hidden>
          {[1, 2, 3].map((n) => (
            <span key={n} className={`h-1 flex-1 rounded-full ${n <= paso ? 'bg-dex-accent' : 'bg-dex-line'}`} />
          ))}
        </div>
      </div>

      {paso === 1 && (
        <fieldset className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/70 p-5">
          <legend className="px-2 text-sm font-bold text-dex-ink">¿Qué ficha quieres actualizar?</legend>
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
          <p className="text-xs text-dex-muted">
            Tu correo no se publica ni va a la ficha. Detalle en la{' '}
            <Link href="/terminos#datos-personales" target="_blank" rel="noopener" className="text-dex-accent underline underline-offset-2">
              cláusula de datos personales
            </Link>
            .
          </p>
        </fieldset>
      )}

      {paso === 2 && (
        <>
          <fieldset className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/70 p-5">
            <legend className="px-2 text-sm font-bold text-dex-ink">Tu personaje</legend>
            <p className="text-xs text-dex-muted">Rellena solo lo que quieras cambiar: lo que dejes en blanco se queda como está.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {camposDelPaso(2)}
              <Campo etiqueta="País">
                {paises.length ? (
                  <select className={claseInput} value={country} onChange={(e) => setCountry(e.target.value)}>
                    <option value="">Sin cambios</option>
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
                  <option value="">Sin cambios</option>
                  {SIGNOS.map((signo) => (
                    <option key={signo} value={signo}>
                      {signo}
                    </option>
                  ))}
                </select>
              </Campo>
            </div>
            <Campo etiqueta="Frase" ayuda="Una línea que te presente (máx. 600 caracteres).">
              <input className={claseInput} maxLength={600} value={phrase} onChange={(e) => setPhrase(e.target.value)} />
            </Campo>
            <Campo etiqueta="Lore" ayuda="Reemplaza tu historia actual. No incluyas datos personales: este campo es público.">
              <textarea className={`${claseInput} min-h-28`} maxLength={4000} value={cardText} onChange={(e) => setCardText(e.target.value)} />
            </Campo>
            <fieldset>
              <legend className="text-xs uppercase tracking-[0.14em] text-dex-muted">Idiomas (si marcas alguno, reemplaza los actuales)</legend>
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
            <div>
              <label className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-dex-muted">
                <input type="checkbox" checked={cambiaColor} onChange={(e) => setCambiaColor(e.target.checked)} />
                Cambiar el color de marca
              </label>
              {cambiaColor && (
                <input
                  type="color"
                  aria-label="Color de marca"
                  className="mt-2 h-10 w-full cursor-pointer rounded-lg border border-dex-line bg-dex-void p-1 sm:w-48"
                  value={themeColor}
                  onChange={(e) => setThemeColor(e.target.value)}
                />
              )}
            </div>
          </fieldset>

          <fieldset className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/70 p-5">
            <legend className="px-2 text-sm font-bold text-dex-ink">Imágenes y redes</legend>
            <p className="text-xs text-dex-muted">
              Las imágenes van como enlace (Drive, Imgur, tu sitio…): el formulario no recibe archivos y el mantenedor las sube al aprobar. El
              arte debe ser tuyo o contar con permiso de su autoría.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo etiqueta="Avatar nuevo">
                <input type="url" className={claseInput} maxLength={500} placeholder="https://" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
              </Campo>
              <Campo etiqueta="Logo nuevo">
                <input type="url" className={claseInput} maxLength={500} placeholder="https://" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} />
              </Campo>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-dex-muted">Redes y canales a añadir o actualizar</p>
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
              <p className="mt-2 text-[11px] text-dex-muted">Las redes se suman a las que ya tienes (o actualizan la de la misma plataforma); no se borra ninguna.</p>
            </div>
          </fieldset>
        </>
      )}

      {paso === 3 && (
        <>
          <fieldset className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/70 p-5">
            <legend className="px-2 text-sm font-bold text-dex-ink">Tus gustos</legend>
            <p className="text-xs text-dex-muted">También opcional: solo lo que haya cambiado.</p>
            <div className="grid gap-4 sm:grid-cols-2">{camposDelPaso(3)}</div>
            <Campo etiqueta="Nota para el mantenedor" ayuda="Opcional. Qué cambió y por qué, si ayuda a revisarlo.">
              <textarea className={`${claseInput} min-h-20`} maxLength={2000} value={nota} onChange={(e) => setNota(e.target.value)} />
            </Campo>
          </fieldset>

          <CampoTrampa valor={website} alCambiar={setWebsite} />
          <AceptaTerminos idUnico="acepta-terminos-modificacion" marcada={acepta} alCambiar={setAcepta} />
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
          {paso < 3 ? 'Siguiente →' : enviando ? 'Enviando…' : 'Enviar solicitud'}
        </button>
        {paso === 3 && <span className="text-xs text-dex-muted">Quedará en espera hasta que el mantenedor la revise.</span>}
      </div>
    </form>
  );
}
