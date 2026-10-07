'use client';
/**
 * Formulario PÚBLICO para pedir cambios en una ficha YA registrada.
 *
 * Es la inscripción sin lo que ya se sabe: no pide nombre ni obliga a rellenar nada de la ficha. Cada
 * campo en blanco significa «no cambia»; el servidor exige al menos un cambio. Nada se aplica solo:
 * queda en la misma cola de revisión, y el mantenedor aplica el parche al aprobar.
 *
 * CUATRO PASOS, y el correo se demuestra ANTES de rellenar nada:
 *   1. Solo el correo → el servidor manda un código.   2. Se pega el código (o se abre el enlace del
 *   correo, que trae aquí con el código ya puesto).   3. Qué cambiar (la ficha sale del correo).
 *   4. Gustos y envío.
 * El código se canjea por un `permiso` que vive en memoria y autoriza UN envío con ese correo: el
 * servidor toma el correo del permiso, no del cuerpo, y la solicitud entra directo a la cola (sin
 * segundo correo). La ficha no se pide: es la de la inscripción con ese correo; solo se escribe si el
 * correo no tiene ninguna (las fichas del scrape original no guardan correo) y se elige si tiene varias.
 *
 * Las preguntas salen de la misma lista que la inscripción (`campos-ficha.ts`). El avatar y el logo se piden como ENLACE
 * (un formulario público que recibe archivos es una puerta a subir basura).
 */
import { SocialIcon } from '@/components/social-icon';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { useI18n } from '@/lib/i18n';
import type { Clave } from '@/lib/i18n/mensajes';

import { ApiError, api } from '@/lib/api';
import { TERMINOS_VERSION } from '@/lib/terminos';
import { useOpcionesFicha } from '@/components/solicitudes/use-opciones-ficha';
import { CAMPOS_PERFIL, SIGNOS, type ClavePerfil } from '@/components/solicitudes/campos-ficha';
import { AceptaTerminos, Aviso, Campo, CampoTrampa, claseBoton, claseInput } from '@/components/solicitudes/campos';

const MAX_REDES = 10;

const TOTAL_PASOS = 4;
type Paso = 1 | 2 | 3 | 4;

interface Red {
  platform: string;
  url: string;
}

export function ModificacionForm() {
  const { t } = useI18n();
  const { paises, idiomas } = useOpcionesFicha();
  const [paso, setPaso] = useState<Paso>(1);
  const [ficha, setFicha] = useState('');
  const [email, setEmail] = useState('');
  const [codigo, setCodigo] = useState('');
  /** Lo que canjea el código: autoriza un envío con el correo verificado. Solo vive en memoria. */
  const [permiso, setPermiso] = useState('');
  const [fichasDelCorreo, setFichasDelCorreo] = useState<Array<{ slug: string; name: string }>>([]);
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

  // El enlace del correo trae el código en el fragmento: abre el formulario en el paso 2 con el código puesto
  // (no se gasta solo: hay que pulsar «Confirmar»). Se borra de la barra para que no quede en el historial.
  useEffect(() => {
    const deEnlace = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('t');
    if (!deEnlace) return;
    setCodigo(deEnlace);
    setPaso(2);
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

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
    if (paso === 1) {
      setEnviando(true);
      try {
        await api.pedirCodigoDeModificacion(email, website);
        setPaso(2);
        window.scrollTo({ top: 0 });
      } catch (causa) {
        setError(causa instanceof ApiError ? causa.message : t('ficha.errorCodigo'));
      } finally {
        setEnviando(false);
      }
      return;
    }
    if (paso === 2) {
      setEnviando(true);
      try {
        const canje = await api.verificarCodigoDeModificacion(codigo.trim());
        setPermiso(canje.permiso);
        setFichasDelCorreo(canje.fichas);
        // Una sola ficha asociada: es esa. Varias: se elige. Ninguna: se escribe.
        setFicha(canje.fichas.length === 1 ? canje.fichas[0].slug : '');
        setPaso(3);
        window.scrollTo({ top: 0 });
      } catch (causa) {
        setError(causa instanceof ApiError ? causa.message : t('ficha.errorConfirmar'));
      } finally {
        setEnviando(false);
      }
      return;
    }
    if (paso === 3) {
      setPaso(4);
      window.scrollTo({ top: 0 });
      return;
    }
    if (!hayCambios) {
      setError(t('mod.errorSinCambios'));
      return;
    }
    if (!acepta) {
      setError(t('mod.errorTerminos'));
      return;
    }
    setEnviando(true);
    try {
      // Sin `email`: el servidor lo toma del permiso (el correo ya demostrado).
      await api.enviarModificacion({
        permiso,
        ficha,
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
      if (causa instanceof ApiError && causa.status === 410) {
        // El permiso caducó o ya se usó: hay que demostrar el correo otra vez.
        setPermiso('');
        setCodigo('');
        setPaso(1);
      }
      setError(causa instanceof ApiError ? causa.message : t('mod.errorEnviar'));
    } finally {
      setEnviando(false);
    }
  };

  const camposDelPaso = (n: Paso) =>
    CAMPOS_PERFIL.filter((c) => c.paso === n).map((campo) => (
      <Campo key={campo.clave} etiqueta={t(`ficha.campo.${campo.clave}` as Clave)}>
        <input
          className={claseInput}
          maxLength={campo.max}
          placeholder={campo.ejemplo ? t(`ficha.ejemplo.${campo.clave}` as Clave) : undefined}
          value={perfil[campo.clave]}
          onChange={(e) => setPerfil((actual) => ({ ...actual, [campo.clave]: e.target.value }))}
        />
      </Campo>
    ));

  if (enviada) {
    return (
      <div className="space-y-4" data-testid="modificacion-enviada">
        <Aviso tipo="ok">
          <strong>{t('mod.recibidaTitulo')}</strong>{t('mod.recibidaTexto')}
        </Aviso>
        <Link href="/" className="inline-block text-sm text-dex-accent underline underline-offset-2">
          {t('ficha.volverCatalogo')}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="relative space-y-6" data-testid="modificacion-form">
      <div>
        <p className="text-xs uppercase tracking-[0.14em] text-dex-muted" data-testid="modificacion-paso" aria-live="polite">
          {t('ficha.paso', { n: paso, total: TOTAL_PASOS, titulo: t(`mod.titulo.${paso}` as Clave) })}
        </p>
        <div className="mt-2 flex gap-1.5" aria-hidden>
          {[1, 2, 3, 4].map((n) => (
            <span key={n} className={`h-1 flex-1 rounded-full ${n <= paso ? 'bg-dex-accent' : 'bg-dex-line'}`} />
          ))}
        </div>
      </div>

      {paso === 1 && (
        <fieldset className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/70 p-5">
          <legend className="px-2 text-sm font-bold text-dex-ink">{t('mod.conQueCorreo')}</legend>
          <Campo
            etiqueta={t('ficha.correo')}
            obligatorio
            confidencial
            ayuda={t('mod.correoAyuda')}
          >
            <input type="email" className={claseInput} required maxLength={200} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Campo>
          <CampoTrampa valor={website} alCambiar={setWebsite} />
          <p className="text-xs text-dex-muted">
            {t('mod.privacidad')}
            <Link href="/terminos#datos-personales" target="_blank" rel="noopener" className="text-dex-accent underline underline-offset-2">
              {t('ficha.privacidadLink')}
            </Link>
            .
          </p>
        </fieldset>
      )}

      {paso === 2 && (
        <fieldset className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/70 p-5" data-testid="modificacion-codigo">
          <legend className="px-2 text-sm font-bold text-dex-ink">{t('ficha.codigoLegend')}</legend>
          {email && (
            <p className="text-sm text-dex-muted">
              {t('ficha.codigoMandadoA')}<strong>{email}</strong>{t('ficha.codigoMandadoB')}
            </p>
          )}
          <Campo etiqueta={t('ficha.codigoEtiqueta')} obligatorio>
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
      )}

      {paso === 3 && (
        <>
          <fieldset className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/70 p-5" data-testid="modificacion-ficha">
            <legend className="px-2 text-sm font-bold text-dex-ink">{t('mod.tuFicha')}</legend>
            {fichasDelCorreo.length === 1 && (
              <p className="text-sm text-dex-ink">
                {t('mod.vasActualizarA')}<strong>{fichasDelCorreo[0].name}</strong>{t('mod.vasActualizarB')}
              </p>
            )}
            {fichasDelCorreo.length > 1 && (
              <Campo etiqueta={t('mod.cualFicha')} obligatorio>
                <select className={claseInput} required value={ficha} onChange={(e) => setFicha(e.target.value)}>
                  <option value="">{t('mod.eligeUna')}</option>
                  {fichasDelCorreo.map((f) => (
                    <option key={f.slug} value={f.slug}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </Campo>
            )}
            {fichasDelCorreo.length === 0 && (
              <Campo
                etiqueta={t('mod.fichaEtiqueta')}
                obligatorio
                ayuda={t('mod.fichaAyuda')}
              >
                <input className={claseInput} required maxLength={300} value={ficha} onChange={(e) => setFicha(e.target.value)} />
              </Campo>
            )}
          </fieldset>
          <fieldset className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/70 p-5">
            <legend className="px-2 text-sm font-bold text-dex-ink">{t('ficha.tuPersonaje')}</legend>
            <p className="text-xs text-dex-muted">{t('mod.personajeAyuda')}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {camposDelPaso(2)}
              <Campo etiqueta={t('ficha.pais')}>
                {paises.length ? (
                  <select className={claseInput} value={country} onChange={(e) => setCountry(e.target.value)}>
                    <option value="">{t('ficha.sinCambios')}</option>
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
              <Campo etiqueta={t('ficha.signo')}>
                <select className={claseInput} value={zodiac} onChange={(e) => setZodiac(e.target.value)}>
                  <option value="">{t('ficha.sinCambios')}</option>
                  {SIGNOS.map((signo) => (
                    <option key={signo} value={signo}>
                      {t(`ficha.signo.${signo}` as Clave)}
                    </option>
                  ))}
                </select>
              </Campo>
            </div>
            <Campo etiqueta={t('ficha.frase')} ayuda={t('ficha.fraseAyuda')}>
              <input className={claseInput} maxLength={600} value={phrase} onChange={(e) => setPhrase(e.target.value)} />
            </Campo>
            <Campo etiqueta={t('ficha.lore')} ayuda={t('mod.loreAyuda')}>
              <textarea className={`${claseInput} min-h-28`} maxLength={4000} value={cardText} onChange={(e) => setCardText(e.target.value)} />
            </Campo>
            <fieldset>
              <legend className="text-xs uppercase tracking-[0.14em] text-dex-muted">{t('mod.idiomas')}</legend>
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
                {t('mod.cambiarColor')}
              </label>
              {cambiaColor && (
                <input
                  type="color"
                  aria-label={t('ficha.colorMarca')}
                  className="mt-2 h-10 w-full cursor-pointer rounded-lg border border-dex-line bg-dex-void p-1 sm:w-48"
                  value={themeColor}
                  onChange={(e) => setThemeColor(e.target.value)}
                />
              )}
            </div>
          </fieldset>

          <fieldset className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/70 p-5">
            <legend className="px-2 text-sm font-bold text-dex-ink">{t('mod.imagenesRedes')}</legend>
            <p className="text-xs text-dex-muted">
              {t('mod.imagenesAyuda')}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo etiqueta={t('mod.avatarNuevo')}>
                <input type="url" className={claseInput} maxLength={500} placeholder="https://" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
              </Campo>
              <Campo etiqueta={t('mod.logoNuevo')}>
                <input type="url" className={claseInput} maxLength={500} placeholder="https://" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} />
              </Campo>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-dex-muted">{t('mod.redesTitulo')}</p>
              <div className="mt-2 space-y-2">
                {socials.map((red, indice) => (
                  <div key={indice} className="grid grid-cols-[1.25rem_8rem_1fr_auto] items-center gap-2">
                    <SocialIcon platform={red.platform} url={red.url} className="h-5 w-5 text-dex-muted" />
                    <input
                      aria-label={t('ficha.plataforma', { n: indice + 1 })}
                      className={`${claseInput} mt-0`}
                      placeholder={t('ficha.plataformaEjemplo')}
                      maxLength={40}
                      value={red.platform}
                      onChange={(e) => cambiarRed(indice, { platform: e.target.value })}
                    />
                    <input
                      aria-label={t('ficha.enlace', { n: indice + 1 })}
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
                      aria-label={t('ficha.quitarEnlace', { n: indice + 1 })}
                    >
                      {t('ficha.quitar')}
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
                  {t('ficha.anadirRed')}
                </button>
              )}
              <p className="mt-2 text-[11px] text-dex-muted">{t('mod.redesNota')}</p>
            </div>
          </fieldset>
        </>
      )}

      {paso === 4 && (
        <>
          <fieldset className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/70 p-5">
            <legend className="px-2 text-sm font-bold text-dex-ink">{t('ficha.tusGustos')}</legend>
            <p className="text-xs text-dex-muted">{t('mod.gustosAyuda')}</p>
            <div className="grid gap-4 sm:grid-cols-2">{camposDelPaso(3)}</div>
            <Campo etiqueta={t('mod.nota')} ayuda={t('mod.notaAyuda')}>
              <textarea className={`${claseInput} min-h-20`} maxLength={2000} value={nota} onChange={(e) => setNota(e.target.value)} />
            </Campo>
          </fieldset>

          <AceptaTerminos idUnico="acepta-terminos-modificacion" marcada={acepta} alCambiar={setAcepta} />
        </>
      )}

      {error && <Aviso tipo="error">{error}</Aviso>}
      <div className="flex flex-wrap items-center gap-4">
        {(paso === 2 || paso === 4) && (
          <button
            type="button"
            className="rounded-xl border border-dex-line px-5 py-2.5 text-sm text-dex-muted hover:text-dex-ink"
            onClick={() => {
              setError(null);
              setPaso((paso - 1) as Paso);
            }}
          >
            {t('ficha.volver')}
          </button>
        )}
        <button type="submit" className={claseBoton} disabled={enviando || (paso === 4 && !acepta)}>
          {paso === 1
            ? enviando
              ? t('ficha.enviando')
              : t('ficha.enviarCodigo')
            : paso === 2
              ? enviando
                ? t('ficha.confirmando')
                : t('ficha.confirmarCodigo')
              : paso === 3
                ? t('ficha.siguiente')
                : enviando
                  ? t('ficha.enviando')
                  : t('mod.enviar')}
        </button>
        {paso === 4 && <span className="text-xs text-dex-muted">{t('ficha.enEspera')}</span>}
      </div>
    </form>
  );
}
