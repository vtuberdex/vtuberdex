"use client";
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
import { useEffect, useState } from "react";

import { useI18n } from "@/lib/i18n";
import type { Clave } from "@/lib/i18n/mensajes";
import { BCP47 } from "@/lib/i18n/locales";

import { ApiError, api, type BorradorDeInscripcion } from "@/lib/api";
import { TERMINOS_VERSION } from "@/lib/terminos";
import { useOpcionesFicha } from "@/components/solicitudes/use-opciones-ficha";
import { CAMPOS_PERFIL } from "@/components/solicitudes/campos-ficha";
import {
  AceptaTerminos,
  Aviso,
  Campo,
  claseInput,
} from "@/components/solicitudes/campos";
import {
  BarraDePasos,
  BotoneraPasos,
  CamposDelPaso,
  CamposPaisYSigno,
  EditorRedes,
  FichaRecibida,
  PasoCodigo,
  PasoCorreo,
  SelectorIdiomas,
  perfilVacio,
  redesEscritas,
  useCodigoDelEnlace,
  useEnvio,
  type Perfil,
  type Red,
} from "@/components/solicitudes/pasos-ficha";

/** Cuánto se espera tras el último cambio para guardar el borrador (no una petición por tecla). */
const ESPERA_GUARDADO_MS = 1200;

const TOTAL_PASOS = 5;
type Paso = 1 | 2 | 3 | 4 | 5;

export function InscripcionForm() {
  const { t, locale } = useI18n();
  const { paises, idiomas } = useOpcionesFicha();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [codigo, setCodigo] = useState("");
  /** Lo que canjea el código: autoriza guardar el borrador y enviar. Solo vive en memoria. */
  const [sesion, setSesion] = useState("");
  const [country, setCountry] = useState("");
  const [languages, setLanguages] = useState<string[]>([]);
  const [phrase, setPhrase] = useState("");
  const [paso, setPaso] = useState<Paso>(1);
  const [perfil, setPerfil] = useState<Perfil>(perfilVacio);
  const [zodiac, setZodiac] = useState("");
  const [cardText, setCardText] = useState("");
  const [themeColor, setThemeColor] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [socials, setSocials] = useState<Red[]>([{ platform: "", url: "" }]);
  const [acepta, setAcepta] = useState(false);
  const [website, setWebsite] = useState("");
  const { enviando, error, setError, intentar } = useEnvio();
  const [enviada, setEnviada] = useState(false);
  /** Estado del borrador: lo que se le muestra a la persona. */
  const [borrador, setBorrador] = useState<{
    estado: "guardando" | "guardado" | "error";
    hora?: string;
  } | null>(null);
  const [recuperado, setRecuperado] = useState<string | null>(null);

  useCodigoDelEnlace((deEnlace) => {
    setCodigo(deEnlace);
    setPaso(2);
  });

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
    setBorrador({ estado: "guardando" });
    const espera = setTimeout(() => {
      api
        .guardarBorradorDeInscripcion(
          sesion,
          JSON.parse(huella) as BorradorDeInscripcion,
        )
        .then(({ actualizado }) =>
          setBorrador({
            estado: "guardado",
            hora: new Date(actualizado).toLocaleTimeString(BCP47[locale], {
              hour: "2-digit",
              minute: "2-digit",
            }),
          }),
        )
        .catch(() => setBorrador({ estado: "error" }));
    }, ESPERA_GUARDADO_MS);
    return () => clearTimeout(espera);
    // `huella` ya resume todos los campos y el paso; `sesion`/`enviada` cambian el permiso de guardar.
  }, [huella, sesion, paso, enviada, locale]);

  /** Carga en el formulario lo que había guardado. */
  const aplicarBorrador = (d: BorradorDeInscripcion) => {
    const texto = (v: unknown) => (typeof v === "string" ? v : "");
    setName(texto(d.name));
    setCountry(texto(d.country));
    setLanguages(Array.isArray(d.languages) ? d.languages : []);
    setPhrase(texto(d.phrase));
    setCardText(texto(d.cardText));
    setThemeColor(texto(d.themeColor));
    setImageUrl(texto(d.imageUrl));
    setLogoUrl(texto(d.logoUrl));
    setZodiac(texto(d.zodiac));
    setPerfil(
      Object.fromEntries(
        CAMPOS_PERFIL.map((c) => [c.clave, texto(d[c.clave])]),
      ) as Perfil,
    );
    setSocials(
      Array.isArray(d.socials) && d.socials.length
        ? d.socials
        : [{ platform: "", url: "" }],
    );
  };

  const enviar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setError(null);
    // La validación nativa (`required`) del paso corre antes de este `submit`: si llegamos aquí los datos de
    // este paso están completos.
    if (paso === 1) {
      await intentar(async () => {
        await api.pedirCodigoDeInscripcion(email, website);
        setPaso(2);
        window.scrollTo({ top: 0 });
      }, "ficha.errorCodigo");
      return;
    }
    if (paso === 2) {
      await intentar(async () => {
        const canje = await api.verificarCodigoDeInscripcion(codigo.trim());
        setSesion(canje.sesion);
        if (canje.borrador) {
          // Había un borrador de este correo: manda sobre lo recién escrito y se sigue donde se quedó.
          aplicarBorrador(canje.borrador.datos);
          setRecuperado(
            new Date(canje.borrador.actualizado).toLocaleString(BCP47[locale], {
              dateStyle: "medium",
              timeStyle: "short",
            }),
          );
          setPaso(canje.borrador.datos.paso);
        } else {
          setRecuperado(null);
          setPaso(3);
        }
        window.scrollTo({ top: 0 });
      }, "ficha.errorConfirmar");
      return;
    }
    if (paso < 5) {
      setPaso((paso + 1) as Paso);
      window.scrollTo({ top: 0 });
      return;
    }
    if (!acepta) {
      setError(t("ins.errorTerminos"));
      return;
    }
    await intentar(
      async () => {
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
          socials: redesEscritas(socials),
          aceptaTerminos: true,
          terminosVersion: TERMINOS_VERSION,
          website,
        });
        setEnviada(true);
      },
      "ins.errorEnviar",
      (causa) => {
        if (causa instanceof ApiError && causa.status === 410) {
          // La sesión caducó (el borrador sigue guardado): hay que demostrar el correo otra vez.
          setSesion("");
          setCodigo("");
          setPaso(1);
        }
      },
    );
  };

  if (enviada) {
    return (
      <FichaRecibida
        testId="inscripcion-enviada"
        titulo="ins.recibidaTitulo"
        texto="ins.recibidaTexto"
      />
    );
  }

  return (
    <form
      onSubmit={enviar}
      className="relative space-y-6"
      data-testid="inscripcion-form"
      noValidate={false}
    >
      <BarraDePasos
        testId="inscripcion-paso"
        paso={paso}
        total={TOTAL_PASOS}
        titulo={t(`ins.titulo.${paso}` as Clave)}
      >
        {paso >= 3 && borrador && (
          <p
            className="mt-2 text-xs text-dex-muted"
            data-testid="inscripcion-borrador"
            aria-live="polite"
          >
            {borrador.estado === "guardando" && t("ins.borradorGuardando")}
            {borrador.estado === "guardado" &&
              (borrador.hora
                ? t("ins.borradorGuardadoHora", { hora: borrador.hora })
                : t("ins.borradorGuardado"))}
            {borrador.estado === "error" && t("ins.borradorError")}
          </p>
        )}
      </BarraDePasos>

      {paso >= 3 && recuperado && (
        <Aviso tipo="ok">
          <strong>{t("ins.recuperadoTitulo")}</strong>
          {t("ins.recuperadoTexto", { fecha: recuperado })}
        </Aviso>
      )}

      {paso === 1 && (
        <PasoCorreo
          leyenda={t("ins.paraEmpezar")}
          ayuda={t("ins.correoAyuda")}
          privacidad={t("ins.privacidad")}
          email={email}
          setEmail={setEmail}
          website={website}
          setWebsite={setWebsite}
        >
          <Campo etiqueta={t("ins.nombreArtistico")} obligatorio>
            <input
              className={claseInput}
              required
              maxLength={160}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Campo>
        </PasoCorreo>
      )}

      {paso === 2 && (
        <PasoCodigo
          testId="inscripcion-codigo"
          email={email}
          codigo={codigo}
          setCodigo={setCodigo}
        />
      )}

      {paso === 3 && (
        <fieldset className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/70 p-5">
          <legend className="px-2 text-sm font-bold text-dex-ink">
            {t("ins.fichaPublica")}
          </legend>
          <Campo etiqueta={t("ficha.colorMarca")} ayuda={t("ins.colorAyuda")}>
            <input
              type="color"
              aria-label={t("ficha.colorMarca")}
              className="mt-1 h-10 w-full cursor-pointer rounded-lg border border-dex-line bg-dex-void p-1 sm:w-48"
              value={themeColor || "#5eead4"}
              onChange={(e) => setThemeColor(e.target.value)}
            />
          </Campo>
          <SelectorIdiomas
            leyenda={
              <>
                {t("ficha.leyendaIdiomas")}{" "}
                <span className="text-rose-300" aria-hidden>
                  *
                </span>
              </>
            }
            idiomas={idiomas}
            languages={languages}
            setLanguages={setLanguages}
          />
          <Campo etiqueta={t("ficha.frase")} ayuda={t("ficha.fraseAyuda")}>
            <input
              className={claseInput}
              maxLength={600}
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
            />
          </Campo>
          <EditorRedes
            titulo={
              <>
                {t("ins.redes")}{" "}
                <span className="text-rose-300" aria-hidden>
                  *
                </span>
              </>
            }
            socials={socials}
            setSocials={setSocials}
          />
        </fieldset>
      )}

      {paso === 4 && (
        <>
          <fieldset
            className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/70 p-5"
            data-testid="inscripcion-paso-2"
          >
            <legend className="px-2 text-sm font-bold text-dex-ink">
              {t("ins.imagenes")}
            </legend>
            <p className="text-xs text-dex-muted">{t("ins.imagenesAyuda")}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo
                etiqueta={t("ficha.avatar")}
                obligatorio
                ayuda={t("ins.avatarAyuda")}
              >
                <input
                  type="url"
                  className={claseInput}
                  required
                  maxLength={500}
                  placeholder="https://"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                />
              </Campo>
              <Campo etiqueta={t("ficha.logo")} obligatorio>
                <input
                  type="url"
                  className={claseInput}
                  required
                  maxLength={500}
                  placeholder="https://"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                />
              </Campo>
            </div>
          </fieldset>

          <fieldset className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/70 p-5">
            <legend className="px-2 text-sm font-bold text-dex-ink">
              {t("ficha.tuPersonaje")}
            </legend>
            <p className="text-xs text-dex-muted">
              {t("ins.personajeAyudaA")}
              <span className="text-rose-300">*</span>
              {t("ins.personajeAyudaB")}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <CamposDelPaso
                n={2}
                perfil={perfil}
                setPerfil={setPerfil}
                obligatorio
              />
              <CamposPaisYSigno
                paises={paises}
                country={country}
                setCountry={setCountry}
                zodiac={zodiac}
                setZodiac={setZodiac}
                vacio={t("ficha.elige")}
              />
            </div>
            <Campo
              etiqueta={t("ficha.lore")}
              obligatorio
              ayuda={t("ins.loreAyuda")}
            >
              <textarea
                className={`${claseInput} min-h-28`}
                required
                maxLength={4000}
                value={cardText}
                onChange={(e) => setCardText(e.target.value)}
              />
            </Campo>
          </fieldset>
        </>
      )}

      {paso === 5 && (
        <>
          <fieldset
            className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/70 p-5"
            data-testid="inscripcion-paso-3"
          >
            <legend className="px-2 text-sm font-bold text-dex-ink">
              {t("ficha.tusGustos")}
            </legend>
            <p className="text-xs text-dex-muted">{t("ins.gustosAyuda")}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <CamposDelPaso
                n={3}
                perfil={perfil}
                setPerfil={setPerfil}
                obligatorio
              />
            </div>
          </fieldset>

          <AceptaTerminos
            idUnico="acepta-terminos-inscripcion"
            marcada={acepta}
            alCambiar={setAcepta}
          />
        </>
      )}

      <BotoneraPasos
        paso={paso}
        total={TOTAL_PASOS}
        error={error}
        enviando={enviando}
        acepta={acepta}
        conVolver={paso === 2 || paso >= 4}
        alVolver={() => {
          setError(null);
          setPaso((paso - 1) as Paso);
        }}
        textoEnviar={t("ins.enviar")}
      />
    </form>
  );
}
