"use client";
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
import { useState } from "react";

import { useI18n } from "@/lib/i18n";
import type { Clave } from "@/lib/i18n/mensajes";

import { ApiError, api } from "@/lib/api";
import { TERMINOS_VERSION } from "@/lib/terminos";
import { SubidaImagen } from "@/components/solicitudes/subida-imagen";
import { useOpcionesFicha } from "@/components/solicitudes/use-opciones-ficha";
import {
  AceptaTerminos,
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
} from "@/components/solicitudes/pasos-ficha";

const TOTAL_PASOS = 4;
type Paso = 1 | 2 | 3 | 4;

export function ModificacionForm() {
  const { t } = useI18n();
  const { paises, idiomas } = useOpcionesFicha();
  const [paso, setPaso] = useState<Paso>(1);
  const [ficha, setFicha] = useState("");
  const [email, setEmail] = useState("");
  const [codigo, setCodigo] = useState("");
  /** Lo que canjea el código: autoriza un envío con el correo verificado. Solo vive en memoria. */
  const [permiso, setPermiso] = useState("");
  const [fichasDelCorreo, setFichasDelCorreo] = useState<
    Array<{ slug: string; name: string }>
  >([]);
  const [perfil, setPerfil] = useState(perfilVacio);
  const [country, setCountry] = useState("");
  const [zodiac, setZodiac] = useState("");
  const [languages, setLanguages] = useState<string[]>([]);
  const [phrase, setPhrase] = useState("");
  const [cardText, setCardText] = useState("");
  // El selector de color siempre tiene un valor: sin la casilla no se podría decir «no lo cambies».
  const [cambiaColor, setCambiaColor] = useState(false);
  const [themeColor, setThemeColor] = useState("#5eead4");
  // Ids de las imágenes ya subidas (`SubidaImagen`); en blanco = no se cambia.
  const [imageId, setImageId] = useState("");
  const [logoId, setLogoId] = useState("");
  const [socials, setSocials] = useState([{ platform: "", url: "" }]);
  const [nota, setNota] = useState("");
  const [acepta, setAcepta] = useState(false);
  const [website, setWebsite] = useState("");
  const { enviando, error, setError, intentar } = useEnvio();
  const [enviada, setEnviada] = useState(false);

  useCodigoDelEnlace((deEnlace) => {
    setCodigo(deEnlace);
    setPaso(2);
  });

  const redes = redesEscritas(socials);
  const hayCambios =
    [
      phrase,
      cardText,
      country,
      zodiac,
      imageId,
      logoId,
      ...Object.values(perfil),
    ].some((v) => v.trim()) ||
    cambiaColor ||
    languages.length > 0 ||
    redes.length > 0;

  const enviar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setError(null);
    // La validación nativa (`required`) del paso corre antes de este `submit`.
    if (paso === 1) {
      await intentar(async () => {
        await api.pedirCodigoDeModificacion(email, website);
        setPaso(2);
        window.scrollTo({ top: 0 });
      }, "ficha.errorCodigo");
      return;
    }
    if (paso === 2) {
      await intentar(async () => {
        const canje = await api.verificarCodigoDeModificacion(codigo.trim());
        setPermiso(canje.permiso);
        setFichasDelCorreo(canje.fichas);
        // Una sola ficha asociada: es esa. Varias: se elige. Ninguna: se escribe.
        setFicha(canje.fichas.length === 1 ? canje.fichas[0].slug : "");
        setPaso(3);
        window.scrollTo({ top: 0 });
      }, "ficha.errorConfirmar");
      return;
    }
    if (paso === 3) {
      setPaso(4);
      window.scrollTo({ top: 0 });
      return;
    }
    if (!hayCambios) {
      setError(t("mod.errorSinCambios"));
      return;
    }
    if (!acepta) {
      setError(t("mod.errorTerminos"));
      return;
    }
    await intentar(
      async () => {
        // Sin `email`: el servidor lo toma del permiso (el correo ya demostrado).
        await api.enviarModificacion({
          permiso,
          ficha,
          country,
          zodiac,
          languages,
          phrase,
          cardText,
          themeColor: cambiaColor ? themeColor : "",
          imageId,
          logoId,
          ...perfil,
          socials: redes,
          nota,
          aceptaTerminos: true,
          terminosVersion: TERMINOS_VERSION,
          website,
        });
        setEnviada(true);
      },
      "mod.errorEnviar",
      (causa) => {
        if (causa instanceof ApiError && causa.status === 410) {
          // El permiso caducó o ya se usó: hay que demostrar el correo otra vez.
          setPermiso("");
          setCodigo("");
          setPaso(1);
        }
      },
    );
  };

  if (enviada) {
    return (
      <FichaRecibida
        testId="modificacion-enviada"
        titulo="mod.recibidaTitulo"
        texto="mod.recibidaTexto"
      />
    );
  }

  return (
    <form
      onSubmit={enviar}
      className="relative space-y-6"
      data-testid="modificacion-form"
    >
      <BarraDePasos
        testId="modificacion-paso"
        paso={paso}
        total={TOTAL_PASOS}
        titulo={t(`mod.titulo.${paso}` as Clave)}
      />

      {paso === 1 && (
        <PasoCorreo
          leyenda={t("mod.conQueCorreo")}
          ayuda={t("mod.correoAyuda")}
          privacidad={t("mod.privacidad")}
          email={email}
          setEmail={setEmail}
          website={website}
          setWebsite={setWebsite}
        />
      )}

      {paso === 2 && (
        <PasoCodigo
          testId="modificacion-codigo"
          email={email}
          codigo={codigo}
          setCodigo={setCodigo}
        />
      )}

      {paso === 3 && (
        <>
          <fieldset
            className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/70 p-5"
            data-testid="modificacion-ficha"
          >
            <legend className="px-2 text-sm font-bold text-dex-ink">
              {t("mod.tuFicha")}
            </legend>
            {fichasDelCorreo.length === 1 && (
              <p className="text-sm text-dex-ink">
                {t("mod.vasActualizarA")}
                <strong>{fichasDelCorreo[0].name}</strong>
                {t("mod.vasActualizarB")}
              </p>
            )}
            {fichasDelCorreo.length > 1 && (
              <Campo etiqueta={t("mod.cualFicha")} obligatorio>
                <select
                  className={claseInput}
                  required
                  value={ficha}
                  onChange={(e) => setFicha(e.target.value)}
                >
                  <option value="">{t("mod.eligeUna")}</option>
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
                etiqueta={t("mod.fichaEtiqueta")}
                obligatorio
                ayuda={t("mod.fichaAyuda")}
              >
                <input
                  className={claseInput}
                  required
                  maxLength={300}
                  value={ficha}
                  onChange={(e) => setFicha(e.target.value)}
                />
              </Campo>
            )}
          </fieldset>
          <fieldset className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/70 p-5">
            <legend className="px-2 text-sm font-bold text-dex-ink">
              {t("ficha.tuPersonaje")}
            </legend>
            <p className="text-xs text-dex-muted">{t("mod.personajeAyuda")}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <CamposDelPaso n={2} perfil={perfil} setPerfil={setPerfil} />
              <CamposPaisYSigno
                paises={paises}
                country={country}
                setCountry={setCountry}
                zodiac={zodiac}
                setZodiac={setZodiac}
                vacio={t("ficha.sinCambios")}
              />
            </div>
            <Campo etiqueta={t("ficha.frase")} ayuda={t("ficha.fraseAyuda")}>
              <input
                className={claseInput}
                maxLength={600}
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
              />
            </Campo>
            <Campo etiqueta={t("ficha.lore")} ayuda={t("mod.loreAyuda")}>
              <textarea
                className={`${claseInput} min-h-28`}
                maxLength={4000}
                value={cardText}
                onChange={(e) => setCardText(e.target.value)}
              />
            </Campo>
            <SelectorIdiomas
              leyenda={t("mod.idiomas")}
              idiomas={idiomas}
              languages={languages}
              setLanguages={setLanguages}
            />
            <div>
              <label className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-dex-muted">
                <input
                  type="checkbox"
                  checked={cambiaColor}
                  onChange={(e) => setCambiaColor(e.target.checked)}
                />
                {t("mod.cambiarColor")}
              </label>
              {cambiaColor && (
                <input
                  type="color"
                  aria-label={t("ficha.colorMarca")}
                  className="mt-2 h-10 w-full cursor-pointer rounded-lg border border-dex-line bg-dex-void p-1 sm:w-48"
                  value={themeColor}
                  onChange={(e) => setThemeColor(e.target.value)}
                />
              )}
            </div>
          </fieldset>

          <fieldset className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/70 p-5">
            <legend className="px-2 text-sm font-bold text-dex-ink">
              {t("mod.imagenesRedes")}
            </legend>
            <p className="text-xs text-dex-muted">{t("mod.imagenesAyuda")}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <SubidaImagen
                formulario="modificacion"
                credencial={permiso}
                tipo="character"
                campo="imageId"
                etiqueta={t("mod.avatarNuevo")}
                id={imageId}
                onId={setImageId}
              />
              <SubidaImagen
                formulario="modificacion"
                credencial={permiso}
                tipo="logo"
                campo="logoId"
                etiqueta={t("mod.logoNuevo")}
                id={logoId}
                onId={setLogoId}
              />
            </div>
            <EditorRedes
              titulo={t("mod.redesTitulo")}
              socials={socials}
              setSocials={setSocials}
            >
              <p className="mt-2 text-[11px] text-dex-muted">
                {t("mod.redesNota")}
              </p>
            </EditorRedes>
          </fieldset>
        </>
      )}

      {paso === 4 && (
        <>
          <fieldset className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/70 p-5">
            <legend className="px-2 text-sm font-bold text-dex-ink">
              {t("ficha.tusGustos")}
            </legend>
            <p className="text-xs text-dex-muted">{t("mod.gustosAyuda")}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <CamposDelPaso n={3} perfil={perfil} setPerfil={setPerfil} />
            </div>
            <Campo etiqueta={t("mod.nota")} ayuda={t("mod.notaAyuda")}>
              <textarea
                className={`${claseInput} min-h-20`}
                maxLength={2000}
                value={nota}
                onChange={(e) => setNota(e.target.value)}
              />
            </Campo>
          </fieldset>

          <AceptaTerminos
            idUnico="acepta-terminos-modificacion"
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
        conVolver={paso === 2 || paso === 4}
        alVolver={() => {
          setError(null);
          setPaso((paso - 1) as Paso);
        }}
        textoEnviar={t("mod.enviar")}
      />
    </form>
  );
}
