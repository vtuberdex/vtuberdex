'use client';
/**
 * Formulario PÚBLICO de inscripción de una ficha, en CINCO pasos y con el correo demostrado ANTES de
 * rellenar la ficha:
 *
 *   1. Nombre artístico y correo → el servidor manda un código.   2. Se pega el código (o se abre el enlace
 *   del correo, que trae aquí con el código puesto).   3. Color, idiomas, frase y redes.   4. Imágenes y
 *   personaje.   5. Gustos, términos y envío.
 *
 * BORRADOR: al validar el código el servidor emite una `sesion` (se puede usar muchas veces) y desde ahí lo
 * que se escribe se guarda solo, atado al correo. Si se cierra la pestaña o no alcanza a terminar, basta
 * volver, escribir el mismo correo y un código nuevo: se recupera lo guardado y se sigue donde se quedó. Al
 * enviar, el servidor toma el correo de la sesión (no del cuerpo), crea la solicitud en la cola (sin segundo
 * correo) y borra el borrador.
 *
 * No publica nada: el mensaje final dice «recibida», no «creada». El correo es confidencial (nunca viaja a la
 * ficha: ver `server/src/solicitudes.mjs`). El arte del personaje se pide como ENLACE y no como archivo: un
 * formulario público que recibe archivos es una puerta abierta a subir basura; el mantenedor lo descarga y lo
 * sube por su gestor de imágenes.
 */
import { SocialIcon } from '@/components/social-icon';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { useI18n } from '@/lib/i18n';
import type { Clave } from '@/lib/i18n/mensajes';
import { BCP47 } from '@/lib/i18n/locales';

import { ApiError, api, type BorradorDeInscripcion } from '@/lib/api';
import { TERMINOS_VERSION } from '@/lib/terminos';
import { useOpcionesFicha } from '@/components/solicitudes/use-opciones-ficha';
import { CAMPOS_PERFIL, SIGNOS, type ClavePerfil } from '@/components/solicitudes/campos-ficha';
import { AceptaTerminos, Aviso, Campo, CampoTrampa, claseBoton, claseInput } from '@/components/solicitudes/campos';

const MAX_REDES = 10;
/** Cuánto se espera tras el último cambio para guardar el borrador (no una petición por tecla). */
const ESPERA_GUARDADO_MS = 1200;

const TOTAL_PASOS = 5;
type Paso = 1 | 2 | 3 | 4 | 5;

interface Red {
  platform: string;
  url: string;
}

export function InscripcionForm() {
  const { t, locale } = useI18n();
  const { paises, idiomas } = useOpcionesFicha();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [codigo, setCodigo] = useState('');
  /** Lo que canjea el código: autoriza guardar el borrador y enviar. Solo vive en memoria. */
  const [sesion, setSesion] = useState('');
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
  /** Estado del borrador: lo que se le muestra a la persona. */
  const [borrador, setBorrador] = useState<{ estado: 'guardando' | 'guardado' | 'error'; hora?: string } | null>(null);
  const [recuperado, setRecuperado] = useState<string | null>(null);

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

  /** Lo que se guarda como borrador: los campos del formulario y el paso (3 a 5). Nunca los términos ni la trampa. */
  const instantanea = (): BorradorDeInscripcion => ({
    name,
    country,
    languages,
    phrase,
    cardText,
    themeColor,
    imageUrl,
    logoUrl,
    zodiac,
    ...perfil,
    socials,
    paso: (paso >= 5 ? 5 : paso >= 4 ? 4 : 3) as 3 | 4 | 5,
  });

  // Autoguardado: mientras hay sesión y se está rellenando (pasos 3 a 5), se guarda un instante después de
  // dejar de escribir. Es un efecto y no un `onChange` por campo: son ~25 campos y una sola vía para todos.
  const huella = JSON.stringify(instantanea());
  useEffect(() => {
    if (!sesion || paso < 3 || enviada) return;
    setBorrador({ estado: 'guardando' });
    const espera = setTimeout(() => {
      api
        .guardarBorradorDeInscripcion(sesion, JSON.parse(huella) as BorradorDeInscripcion)
        .then(({ actualizado }) =>
          setBorrador({ estado: 'guardado', hora: new Date(actualizado).toLocaleTimeString(BCP47[locale], { hour: '2-digit', minute: '2-digit' }) }),
        )
        .catch(() => setBorrador({ estado: 'error' }));
    }, ESPERA_GUARDADO_MS);
    return () => clearTimeout(espera);
    // `huella` ya resume todos los campos y el paso; `sesion`/`enviada` cambian el permiso de guardar.
  }, [huella, sesion, paso, enviada, locale]);

  /** Carga en el formulario lo que había guardado. */
  const aplicarBorrador = (d: BorradorDeInscripcion) => {
    const texto = (v: unknown) => (typeof v === 'string' ? v : '');
    setName(texto(d.name));
    setCountry(texto(d.country));
    setLanguages(Array.isArray(d.languages) ? d.languages : []);
    setPhrase(texto(d.phrase));
    setCardText(texto(d.cardText));
    setThemeColor(texto(d.themeColor));
    setImageUrl(texto(d.imageUrl));
    setLogoUrl(texto(d.logoUrl));
    setZodiac(texto(d.zodiac));
    setPerfil(Object.fromEntries(CAMPOS_PERFIL.map((c) => [c.clave, texto(d[c.clave])])) as Record<ClavePerfil, string>);
    setSocials(Array.isArray(d.socials) && d.socials.length ? d.socials : [{ platform: '', url: '' }]);
  };

  const enviar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setError(null);
    // La validación nativa (`required`) del paso corre antes de este `submit`: si llegamos aquí los datos de
    // este paso están completos.
    if (paso === 1) {
      setEnviando(true);
      try {
        await api.pedirCodigoDeInscripcion(email, website);
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
        const canje = await api.verificarCodigoDeInscripcion(codigo.trim());
        setSesion(canje.sesion);
        if (canje.borrador) {
          // Había un borrador de este correo: manda sobre lo recién escrito y se sigue donde se quedó.
          aplicarBorrador(canje.borrador.datos);
          setRecuperado(new Date(canje.borrador.actualizado).toLocaleString(BCP47[locale], { dateStyle: 'medium', timeStyle: 'short' }));
          setPaso(canje.borrador.datos.paso);
        } else {
          setRecuperado(null);
          setPaso(3);
        }
        window.scrollTo({ top: 0 });
      } catch (causa) {
        setError(causa instanceof ApiError ? causa.message : t('ficha.errorConfirmar'));
      } finally {
        setEnviando(false);
      }
      return;
    }
    if (paso < 5) {
      setPaso((paso + 1) as Paso);
      window.scrollTo({ top: 0 });
      return;
    }
    if (!acepta) {
      setError(t('ins.errorTerminos'));
      return;
    }
    setEnviando(true);
    try {
      // Sin `email`: el servidor lo toma de la sesión (el correo ya demostrado).
      await api.enviarInscripcion({
        sesion,
        name,
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
      if (causa instanceof ApiError && causa.status === 410) {
        // La sesión caducó (el borrador sigue guardado): hay que demostrar el correo otra vez.
        setSesion('');
        setCodigo('');
        setPaso(1);
      }
      setError(causa instanceof ApiError ? causa.message : t('ins.errorEnviar'));
    } finally {
      setEnviando(false);
    }
  };

  const camposDelPaso = (n: Paso) =>
    CAMPOS_PERFIL.filter((c) => c.paso === n).map((campo) => (
      <Campo key={campo.clave} etiqueta={t(`ficha.campo.${campo.clave}` as Clave)} obligatorio>
        <input
          className={claseInput}
          required
          maxLength={campo.max}
          placeholder={campo.ejemplo ? t(`ficha.ejemplo.${campo.clave}` as Clave) : undefined}
          value={perfil[campo.clave]}
          onChange={(e) => setPerfil((actual) => ({ ...actual, [campo.clave]: e.target.value }))}
        />
      </Campo>
    ));

  if (enviada) {
    return (
      <div className="space-y-4" data-testid="inscripcion-enviada">
        <Aviso tipo="ok">
          <strong>{t('ins.recibidaTitulo')}</strong>{t('ins.recibidaTexto')}
        </Aviso>
        <Link href="/" className="inline-block text-sm text-dex-accent underline underline-offset-2">
          {t('ficha.volverCatalogo')}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="relative space-y-6" data-testid="inscripcion-form" noValidate={false}>
      <div>
        <p className="text-xs uppercase tracking-[0.14em] text-dex-muted" data-testid="inscripcion-paso" aria-live="polite">
          {t('ficha.paso', { n: paso, total: TOTAL_PASOS, titulo: t(`ins.titulo.${paso}` as Clave) })}
        </p>
        <div className="mt-2 flex gap-1.5" aria-hidden>
          {[1, 2, 3, 4, 5].map((n) => (
            <span key={n} className={`h-1 flex-1 rounded-full ${n <= paso ? 'bg-dex-accent' : 'bg-dex-line'}`} />
          ))}
        </div>
        {paso >= 3 && borrador && (
          <p className="mt-2 text-xs text-dex-muted" data-testid="inscripcion-borrador" aria-live="polite">
            {borrador.estado === 'guardando' && t('ins.borradorGuardando')}
            {borrador.estado === 'guardado' && (borrador.hora ? t('ins.borradorGuardadoHora', { hora: borrador.hora }) : t('ins.borradorGuardado'))}
            {borrador.estado === 'error' && t('ins.borradorError')}
          </p>
        )}
      </div>

      {paso >= 3 && recuperado && (
        <Aviso tipo="ok">
          <strong>{t('ins.recuperadoTitulo')}</strong>{t('ins.recuperadoTexto', { fecha: recuperado })}
        </Aviso>
      )}

      {paso === 1 && (
        <fieldset className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/70 p-5">
          <legend className="px-2 text-sm font-bold text-dex-ink">{t('ins.paraEmpezar')}</legend>
        <Campo etiqueta={t('ins.nombreArtistico')} obligatorio>
          <input className={claseInput} required maxLength={160} value={name} onChange={(e) => setName(e.target.value)} />
        </Campo>
          <Campo
            etiqueta={t('ficha.correo')}
            obligatorio
            confidencial
            ayuda={t('ins.correoAyuda')}
          >
            <input type="email" className={claseInput} required maxLength={200} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Campo>
          <CampoTrampa valor={website} alCambiar={setWebsite} />
          <p className="text-xs text-dex-muted">
            {t('ins.privacidad')}
            <Link href="/terminos#datos-personales" target="_blank" rel="noopener" className="text-dex-accent underline underline-offset-2">
              {t('ficha.privacidadLink')}
            </Link>
            .
          </p>
        </fieldset>
      )}

      {paso === 2 && (
        <fieldset className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/70 p-5" data-testid="inscripcion-codigo">
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
      <fieldset className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/70 p-5">
        <legend className="px-2 text-sm font-bold text-dex-ink">{t('ins.fichaPublica')}</legend>
        <Campo etiqueta={t('ficha.colorMarca')} ayuda={t('ins.colorAyuda')}>
          <input
            type="color"
            aria-label={t('ficha.colorMarca')}
            className="mt-1 h-10 w-full cursor-pointer rounded-lg border border-dex-line bg-dex-void p-1 sm:w-48"
            value={themeColor || '#5eead4'}
            onChange={(e) => setThemeColor(e.target.value)}
          />
        </Campo>
        <fieldset>
          <legend className="text-xs uppercase tracking-[0.14em] text-dex-muted">
            {t('ficha.leyendaIdiomas')} <span className="text-rose-300" aria-hidden>*</span>
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
        <Campo etiqueta={t('ficha.frase')} ayuda={t('ficha.fraseAyuda')}>
          <input className={claseInput} maxLength={600} value={phrase} onChange={(e) => setPhrase(e.target.value)} />
        </Campo>
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-dex-muted">
            {t('ins.redes')} <span className="text-rose-300" aria-hidden>*</span>
          </p>
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
        </div>
      </fieldset>

        </>
      )}

      {paso === 4 && (
        <>
          <fieldset className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/70 p-5" data-testid="inscripcion-paso-2">
            <legend className="px-2 text-sm font-bold text-dex-ink">{t('ins.imagenes')}</legend>
            <p className="text-xs text-dex-muted">
              {t('ins.imagenesAyuda')}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo etiqueta={t('ficha.avatar')} obligatorio ayuda={t('ins.avatarAyuda')}>
                <input type="url" className={claseInput} required maxLength={500} placeholder="https://" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
              </Campo>
              <Campo etiqueta={t('ficha.logo')} obligatorio>
                <input type="url" className={claseInput} required maxLength={500} placeholder="https://" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} />
              </Campo>
            </div>
          </fieldset>

          <fieldset className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/70 p-5">
            <legend className="px-2 text-sm font-bold text-dex-ink">{t('ficha.tuPersonaje')}</legend>
            <p className="text-xs text-dex-muted">
              {t('ins.personajeAyudaA')}<span className="text-rose-300">*</span>{t('ins.personajeAyudaB')}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {camposDelPaso(2)}
              <Campo etiqueta={t('ficha.pais')}>
                {paises.length ? (
                  <select className={claseInput} value={country} onChange={(e) => setCountry(e.target.value)}>
                    <option value="">{t('ficha.elige')}</option>
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
                  <option value="">{t('ficha.elige')}</option>
                  {SIGNOS.map((signo) => (
                    <option key={signo} value={signo}>
                      {t(`ficha.signo.${signo}` as Clave)}
                    </option>
                  ))}
                </select>
              </Campo>
            </div>
            <Campo etiqueta={t('ficha.lore')} obligatorio ayuda={t('ins.loreAyuda')}>
              <textarea className={`${claseInput} min-h-28`} required maxLength={4000} value={cardText} onChange={(e) => setCardText(e.target.value)} />
            </Campo>
          </fieldset>
        </>
      )}

      {paso === 5 && (
        <>
          <fieldset className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/70 p-5" data-testid="inscripcion-paso-3">
            <legend className="px-2 text-sm font-bold text-dex-ink">{t('ficha.tusGustos')}</legend>
            <p className="text-xs text-dex-muted">{t('ins.gustosAyuda')}</p>
            <div className="grid gap-4 sm:grid-cols-2">{camposDelPaso(3)}</div>
          </fieldset>

          <AceptaTerminos idUnico="acepta-terminos-inscripcion" marcada={acepta} alCambiar={setAcepta} />
        </>
      )}

      {error && <Aviso tipo="error">{error}</Aviso>}
      <div className="flex flex-wrap items-center gap-4">
        {(paso === 2 || paso >= 4) && (
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
        <button type="submit" className={claseBoton} disabled={enviando || (paso === 5 && !acepta)}>
          {paso === 1
            ? enviando
              ? t('ficha.enviando')
              : t('ficha.enviarCodigo')
            : paso === 2
              ? enviando
                ? t('ficha.confirmando')
                : t('ficha.confirmarCodigo')
              : paso < 5
                ? t('ficha.siguiente')
                : enviando
                  ? t('ficha.enviando')
                  : t('ins.enviar')}
        </button>
        {paso === 5 && <span className="text-xs text-dex-muted">{t('ficha.enEspera')}</span>}
      </div>
    </form>
  );
}
