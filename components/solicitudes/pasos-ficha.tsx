"use client";
/**
 * Piezas de los formularios por PASOS que rellenan una ficha (inscripción y modificación): el código del
 * enlace del correo, la barra de pasos, el paso del correo, el del código, los campos del personaje, los
 * idiomas, las redes y la botonera. Cada formulario decide qué es obligatorio y qué textos lleva; aquí
 * solo vive la forma, para que los dos se vean y se comporten igual.
 */
import Link from "next/link";
import {
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

import { SocialIcon } from "@/components/social-icon";
import { useI18n } from "@/lib/i18n";
import type { Clave } from "@/lib/i18n/mensajes";

import { ApiError } from "@/lib/api";
import type { Opcion } from "@/components/solicitudes/use-opciones-ficha";
import {
  CAMPOS_PERFIL,
  SIGNOS,
  type ClavePerfil,
} from "@/components/solicitudes/campos-ficha";
import {
  Aviso,
  Campo,
  CampoTrampa,
  claseBoton,
  claseInput,
} from "@/components/solicitudes/campos";

const MAX_REDES = 10;

export interface Red {
  platform: string;
  url: string;
}

export type Perfil = Record<ClavePerfil, string>;

const claseFieldset =
  "space-y-4 rounded-2xl border border-dex-line bg-dex-panel/70 p-5";
const claseLeyenda = "px-2 text-sm font-bold text-dex-ink";

/** Un perfil con todas las preguntas en blanco. */
export const perfilVacio = (): Perfil =>
  Object.fromEntries(CAMPOS_PERFIL.map((c) => [c.clave, ""])) as Perfil;

/** Las redes con algo escrito (las filas en blanco no se envían). */
export const redesEscritas = (socials: Red[]) =>
  socials.filter((r) => r.platform.trim() || r.url.trim());

/**
 * El enlace del correo trae el código en el fragmento: abre el formulario en el paso 2 con el código puesto
 * (no se gasta solo: hay que pulsar «Confirmar»). Se borra de la barra para que no quede en el historial.
 */
export function useCodigoDelEnlace(alLlegar: (codigo: string) => void) {
  useEffect(() => {
    const deEnlace = new URLSearchParams(
      window.location.hash.replace(/^#/, ""),
    ).get("t");
    if (!deEnlace) return;
    alLlegar(deEnlace);
    window.history.replaceState(null, "", window.location.pathname);
    // Solo al montar: el fragmento se lee una vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/**
 * El estado de un envío en curso: `intentar` marca «enviando» mientras corre la acción y traduce el fallo a un mensaje
 * (el del servidor si lo hay; si no, `claveError`). Devuelve si salió bien.
 */
export function useEnvio() {
  const { t } = useI18n();
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intentar = async (
    accion: () => Promise<void>,
    claveError: Clave,
    alFallar?: (causa: unknown) => void,
  ) => {
    setEnviando(true);
    try {
      await accion();
      return true;
    } catch (causa) {
      alFallar?.(causa);
      setError(causa instanceof ApiError ? causa.message : t(claveError));
      return false;
    } finally {
      setEnviando(false);
    }
  };
  return { enviando, error, setError, intentar };
}

export function FichaRecibida({
  testId,
  titulo,
  texto,
}: {
  testId: string;
  titulo: Clave;
  texto: Clave;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-4" data-testid={testId}>
      <Aviso tipo="ok">
        <strong>{t(titulo)}</strong>
        {t(texto)}
      </Aviso>
      <Link
        href="/"
        className="inline-block text-sm text-dex-accent underline underline-offset-2"
      >
        {t("ficha.volverCatalogo")}
      </Link>
    </div>
  );
}

/** «Paso n de total · título» y la barra de segmentos; `children` va debajo (p. ej. el estado del borrador). */
export function BarraDePasos({
  testId,
  paso,
  total,
  titulo,
  children,
}: {
  testId: string;
  paso: number;
  total: number;
  titulo: string;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div>
      <p
        className="text-xs uppercase tracking-[0.14em] text-dex-muted"
        data-testid={testId}
        aria-live="polite"
      >
        {t("ficha.paso", { n: paso, total, titulo })}
      </p>
      <div className="mt-2 flex gap-1.5" aria-hidden>
        {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
          <span
            key={n}
            className={`h-1 flex-1 rounded-full ${n <= paso ? "bg-dex-accent" : "bg-dex-line"}`}
          />
        ))}
      </div>
      {children}
    </div>
  );
}

/** Paso 1: el correo (confidencial), la trampa y la nota de privacidad. `children` va antes del correo. */
export function PasoCorreo({
  leyenda,
  ayuda,
  privacidad,
  email,
  setEmail,
  website,
  setWebsite,
  children,
}: {
  leyenda: string;
  ayuda: string;
  privacidad: string;
  email: string;
  setEmail: (v: string) => void;
  website: string;
  setWebsite: (v: string) => void;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <fieldset className={claseFieldset}>
      <legend className={claseLeyenda}>{leyenda}</legend>
      {children}
      <Campo
        etiqueta={t("ficha.correo")}
        obligatorio
        confidencial
        ayuda={ayuda}
      >
        <input
          type="email"
          className={claseInput}
          required
          maxLength={200}
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Campo>
      <CampoTrampa valor={website} alCambiar={setWebsite} />
      <p className="text-xs text-dex-muted">
        {privacidad}
        <Link
          href="/terminos#datos-personales"
          target="_blank"
          rel="noopener"
          className="text-dex-accent underline underline-offset-2"
        >
          {t("ficha.privacidadLink")}
        </Link>
        .
      </p>
    </fieldset>
  );
}

/** Paso 2: pegar el código que llegó al correo. */
export function PasoCodigo({
  testId,
  email,
  codigo,
  setCodigo,
}: {
  testId: string;
  email: string;
  codigo: string;
  setCodigo: (v: string) => void;
}) {
  const { t } = useI18n();
  return (
    <fieldset className={claseFieldset} data-testid={testId}>
      <legend className={claseLeyenda}>{t("ficha.codigoLegend")}</legend>
      {email && (
        <p className="text-sm text-dex-muted">
          {t("ficha.codigoMandadoA")}
          <strong>{email}</strong>
          {t("ficha.codigoMandadoB")}
        </p>
      )}
      <Campo etiqueta={t("ficha.codigoEtiqueta")} obligatorio>
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
  );
}

/** Las preguntas de `CAMPOS_PERFIL` que caen en el paso `n` (2: personaje, 3: gustos). */
export function CamposDelPaso({
  n,
  perfil,
  setPerfil,
  obligatorio = false,
}: {
  n: number;
  perfil: Perfil;
  setPerfil: Dispatch<SetStateAction<Perfil>>;
  obligatorio?: boolean;
}) {
  const { t } = useI18n();
  return (
    <>
      {CAMPOS_PERFIL.filter((c) => c.paso === n).map((campo) => (
        <Campo
          key={campo.clave}
          etiqueta={t(`ficha.campo.${campo.clave}` as Clave)}
          obligatorio={obligatorio}
        >
          <input
            className={claseInput}
            required={obligatorio}
            maxLength={campo.max}
            placeholder={
              campo.ejemplo
                ? t(`ficha.ejemplo.${campo.clave}` as Clave)
                : undefined
            }
            value={perfil[campo.clave]}
            onChange={(e) =>
              setPerfil((actual) => ({
                ...actual,
                [campo.clave]: e.target.value,
              }))
            }
          />
        </Campo>
      ))}
    </>
  );
}

/** País (lista o texto libre si la lista no cargó) y signo; `vacio` es el texto de la opción en blanco. */
export function CamposPaisYSigno({
  paises,
  country,
  setCountry,
  zodiac,
  setZodiac,
  vacio,
}: {
  paises: Opcion[];
  country: string;
  setCountry: (v: string) => void;
  zodiac: string;
  setZodiac: (v: string) => void;
  vacio: string;
}) {
  const { t } = useI18n();
  return (
    <>
      <Campo etiqueta={t("ficha.pais")}>
        {paises.length ? (
          <select
            className={claseInput}
            value={country}
            onChange={(e) => setCountry(e.target.value)}
          >
            <option value="">{vacio}</option>
            {paises.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            className={claseInput}
            maxLength={60}
            value={country}
            onChange={(e) => setCountry(e.target.value)}
          />
        )}
      </Campo>
      <Campo etiqueta={t("ficha.signo")}>
        <select
          className={claseInput}
          value={zodiac}
          onChange={(e) => setZodiac(e.target.value)}
        >
          <option value="">{vacio}</option>
          {SIGNOS.map((signo) => (
            <option key={signo} value={signo}>
              {t(`ficha.signo.${signo}` as Clave)}
            </option>
          ))}
        </select>
      </Campo>
    </>
  );
}

/** Los idiomas como fichas que se marcan y desmarcan. */
export function SelectorIdiomas({
  leyenda,
  idiomas,
  languages,
  setLanguages,
}: {
  leyenda: ReactNode;
  idiomas: Opcion[];
  languages: string[];
  setLanguages: Dispatch<SetStateAction<string[]>>;
}) {
  const alternar = (codigo: string) =>
    setLanguages((actuales) =>
      actuales.includes(codigo)
        ? actuales.filter((c) => c !== codigo)
        : [...actuales, codigo],
    );
  return (
    <fieldset>
      <legend className="text-xs uppercase tracking-[0.14em] text-dex-muted">
        {leyenda}
      </legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {idiomas.map((idioma) => (
          <label
            key={idioma.value}
            className={`cursor-pointer rounded-full border px-3 py-1 text-xs ${
              languages.includes(idioma.value)
                ? "border-dex-accent bg-dex-accent/15 text-dex-ink"
                : "border-dex-line text-dex-muted"
            }`}
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={languages.includes(idioma.value)}
              onChange={() => alternar(idioma.value)}
            />
            {idioma.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Las redes: plataforma + enlace por fila, hasta `MAX_REDES`. `children` va al final (una nota). */
export function EditorRedes({
  titulo,
  socials,
  setSocials,
  children,
}: {
  titulo: ReactNode;
  socials: Red[];
  setSocials: Dispatch<SetStateAction<Red[]>>;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const cambiarRed = (indice: number, cambio: Partial<Red>) =>
    setSocials((actuales) =>
      actuales.map((r, i) => (i === indice ? { ...r, ...cambio } : r)),
    );
  return (
    <div>
      <p className="text-xs uppercase tracking-[0.14em] text-dex-muted">
        {titulo}
      </p>
      <div className="mt-2 space-y-2">
        {socials.map((red, indice) => (
          <div
            key={indice}
            className="grid grid-cols-[1.25rem_8rem_1fr_auto] items-center gap-2"
          >
            <SocialIcon
              platform={red.platform}
              url={red.url}
              className="h-5 w-5 text-dex-muted"
            />
            <input
              aria-label={t("ficha.plataforma", { n: indice + 1 })}
              className={`${claseInput} mt-0`}
              placeholder={t("ficha.plataformaEjemplo")}
              maxLength={40}
              value={red.platform}
              onChange={(e) => cambiarRed(indice, { platform: e.target.value })}
            />
            <input
              aria-label={t("ficha.enlace", { n: indice + 1 })}
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
              onClick={() =>
                setSocials((actuales) =>
                  actuales.filter((_, i) => i !== indice),
                )
              }
              aria-label={t("ficha.quitarEnlace", { n: indice + 1 })}
            >
              {t("ficha.quitar")}
            </button>
          </div>
        ))}
      </div>
      {socials.length < MAX_REDES && (
        <button
          type="button"
          className="mt-2 text-xs text-dex-accent underline underline-offset-2"
          onClick={() =>
            setSocials((actuales) => [...actuales, { platform: "", url: "" }])
          }
        >
          {t("ficha.anadirRed")}
        </button>
      )}
      {children}
    </div>
  );
}

/**
 * El error del envío (si hay) y la botonera: «Volver» (si `conVolver`) y el botón principal, cuyo texto depende del paso (1: pedir código,
 * 2: confirmarlo, intermedios: siguiente, último: `textoEnviar`).
 */
export function BotoneraPasos({
  paso,
  total,
  error,
  enviando,
  acepta,
  conVolver,
  alVolver,
  textoEnviar,
}: {
  paso: number;
  error: string | null;
  total: number;
  enviando: boolean;
  acepta: boolean;
  conVolver: boolean;
  alVolver: () => void;
  textoEnviar: string;
}) {
  const { t } = useI18n();
  let texto: string;
  if (paso === 1)
    texto = enviando ? t("ficha.enviando") : t("ficha.enviarCodigo");
  else if (paso === 2)
    texto = enviando ? t("ficha.confirmando") : t("ficha.confirmarCodigo");
  else if (paso < total) texto = t("ficha.siguiente");
  else texto = enviando ? t("ficha.enviando") : textoEnviar;
  return (
    <>
      {error && <Aviso tipo="error">{error}</Aviso>}
      <div className="flex flex-wrap items-center gap-4">
        {conVolver && (
          <button
            type="button"
            className="rounded-xl border border-dex-line px-5 py-2.5 text-sm text-dex-muted hover:text-dex-ink"
            onClick={alVolver}
          >
            {t("ficha.volver")}
          </button>
        )}
        <button
          type="submit"
          className={claseBoton}
          disabled={enviando || (paso === total && !acepta)}
        >
          {texto}
        </button>
        {paso === total && (
          <span className="text-xs text-dex-muted">{t("ficha.enEspera")}</span>
        )}
      </div>
    </>
  );
}
