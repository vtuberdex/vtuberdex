// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
"use client";

/**
 * «Mi ficha» (`/mi-ficha#t=<token>`): donde un VTuber reparte los puntos de habilidad que ganó al subir de nivel.
 *
 * Pensada para quien no es técnico: un número grande («Puntos para repartir»), una lista de habilidades con
 * su rango en puntitos y UN botón «Subir» por habilidad. Nada se escribe ni se paga: cada clic gasta un
 * punto y el rango se ve al instante. Si algo falla, el mensaje dice qué hacer.
 *
 * El token (el enlace mágico del correo) vive en el FRAGMENTO de la URL: no llega a nginx ni a los logs, y
 * se queda en la barra para que recargar la página o guardarla en favoritos siga funcionando. NO se gasta al
 * abrir: dura 7 días y se puede volver a él. Sin token, la pantalla ofrece pedir el enlace con el correo.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  Aviso,
  claseBoton,
  claseInput,
  claseEtiqueta,
} from "@/components/solicitudes/campos";
import {
  ApiError,
  api,
  type HabilidadMejorable,
  type RespuestaMiFicha,
  type VistaMiFicha,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { Clave } from "@/lib/i18n/mensajes";
import { AtributosPanel } from "./atributos";
import {
  ConfirmarReinicio,
  FilaSubible,
  Rango,
  SeccionMinecraft,
  SeccionMisiones,
  SeccionStats,
  claseSecundario,
} from "./secciones";

const CATEGORIAS: Array<HabilidadMejorable["category"]> = [
  "active",
  "passive",
  "ultimate",
  "other",
];

/** Pide el enlace con el correo. Responde igual para cualquiera: no dice si el correo está inscrito. */
export function PedirEnlace({ aviso }: Readonly<{ aviso?: string }>) {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enviar = async (e: React.SubmitEvent) => {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      await api.pedirEnlaceDeMiFicha(email.trim());
      setListo(true);
    } catch (error_) {
      setError(
        error_ instanceof ApiError ? error_.message : t("mificha.pedirError"),
      );
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form
      onSubmit={enviar}
      className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/70 p-5"
      data-testid="mificha-pedir"
    >
      {aviso && <Aviso tipo="error">{aviso}</Aviso>}
      <div>
        <h2 className="text-base font-bold text-dex-ink">
          {t("mificha.pedirTitulo")}
        </h2>
        <p className="mt-1 text-sm text-dex-muted">{t("mificha.pedirTexto")}</p>
      </div>
      {listo ? (
        <Aviso tipo="ok">{t("mificha.pedirListo")}</Aviso>
      ) : (
        <>
          <label className={claseEtiqueta}>
            {t("ficha.correo")}
            <input
              type="email"
              required
              maxLength={200}
              autoComplete="email"
              className={claseInput}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          {error && <Aviso tipo="error">{error}</Aviso>}
          <button type="submit" disabled={enviando} className={claseBoton}>
            {enviando ? t("mificha.pedirEnviando") : t("mificha.pedirBoton")}
          </button>
        </>
      )}
    </form>
  );
}

type Traducir = ReturnType<typeof useI18n>["t"];

/** Lo que se pide al servidor al repartir (o devolver) puntos: la misma lista que acepta `api.repartirPuntos`. */
type AccionDePuntos = Parameters<typeof api.repartirPuntos>[2];

const CONVERTIR_SOBRANTES = "convertir-sobrantes";

/** El 410 es el enlace caducado (vuelve a pedirlo) y el 404 un correo sin fichas; lo demás es un fallo sin más. */
function tipoDeError(estado: number): "caducado" | "sin_fichas" | "otro" {
  if (estado === 410) {
    return "caducado";
  }
  if (estado === 404) {
    return "sin_fichas";
  }
  return "otro";
}

/**
 * El aviso que sigue a un reparto que salió bien, leído de la ficha YA actualizada (el rango o el valor nuevo).
 * `null` = un reinicio: no hay aviso, solo se cierra su «¿seguro?».
 */
function textoTrasRepartir(
  t: Traducir,
  accion: AccionDePuntos,
  ficha: VistaMiFicha,
  { clave, nombre, convertidos }: { clave?: string; nombre: string; convertidos: number },
): string | null {
  if (accion === "subir" && clave) {
    const nuevo = ficha.puntos.habilidades.find((h) => h.clave === clave);
    return t("mificha.subioA", { nombre, n: nuevo?.rango ?? 0 });
  }
  if (accion === "subir-stat" && clave) {
    const nuevo = ficha.statsPuntos?.stats.find((s) => s.slug === clave);
    return t("mificha.statsSubioA", { nombre, valor: nuevo?.valor ?? 0 });
  }
  if (accion === CONVERTIR_SOBRANTES) {
    return t("mificha.sobrantesListo", { n: convertidos });
  }
  return null;
}

export function MiFicha() {
  const { t } = useI18n();
  const [token, setToken] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const [datos, setDatos] = useState<RespuestaMiFicha | null>(null);
  const [error, setError] = useState<{
    tipo: "caducado" | "sin_fichas" | "otro";
    texto?: string;
  } | null>(null);
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{
    tipo: "ok" | "error";
    texto: string;
  } | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [confirmandoStats, setConfirmandoStats] = useState(false);
  const [codigoMinecraft, setCodigoMinecraft] = useState<string | null>(null);

  const cargar = useCallback(async (tk: string, slug?: string) => {
    try {
      setDatos(await api.miFicha(tk, slug));
      setError(null);
    } catch (error_) {
      const estado = error_ instanceof ApiError ? error_.status : 0;
      setError({ tipo: tipoDeError(estado) });
    }
  }, []);

  useEffect(() => {
    const m = /(?:^#|&)t=([^&]+)/.exec(window.location.hash);
    const tk = m ? decodeURIComponent(m[1]) : null;
    setToken(tk);
    setListo(true);
    if (tk) {
      void cargar(tk);
    }
  }, [cargar]);

  // Todos los manejadores van en `useCallback` y ANTES de los retornos tempranos (las reglas de los
  // hooks): la vista los recibe estables. La ficha sobre la que actúan es la de `datos` de este
  // render, la misma que se ve; sin datos no hay botones que los llamen.

  /** Un enlace caducado vuelve a pedir el enlace; cualquier otro fallo se avisa sin perder la ficha. */
  const avisarFallo = useCallback(
    (causa: unknown) => {
      if (causa instanceof ApiError && causa.status === 410) {
        setError({ tipo: "caducado" });
      } else {
        setAviso({
          tipo: "error",
          texto:
            causa instanceof ApiError
              ? causa.message
              : t("mificha.errorGeneral"),
        });
      }
    },
    [t],
  );

  const aplicar = useCallback(
    async (accion: AccionDePuntos, clave?: string, nombre?: string) => {
      if (!token || !datos) {
        return;
      }
      const vista = datos.ficha;
      setOcupada(clave ?? "reiniciar");
      setAviso(null);
      // El sobrante se lee ANTES de convertir: después ya es 0 y el aviso diría «pasaste 0».
      const convertidos =
        accion === CONVERTIR_SOBRANTES ? (vista.puntos.sobrantes ?? 0) : 0;
      try {
        const r = await api.repartirPuntos(token, vista.slug, accion, clave);
        setDatos((actual) =>
          actual ? { ...actual, ficha: r.ficha } : actual,
        );
        const texto = textoTrasRepartir(t, accion, r.ficha, {
          clave,
          nombre: nombre ?? "",
          convertidos,
        });
        if (texto === null) {
          setConfirmando(false);
          setConfirmandoStats(false);
        } else {
          setAviso({ tipo: "ok", texto });
        }
      } catch (error_) {
        avisarFallo(error_);
      } finally {
        setOcupada(null);
      }
    },
    [token, datos, t, avisarFallo],
  );

  // Los seis atributos se guardan de una vez (la distribución completa): el servidor valida el tope
  // de 200 puntos y de 100 por atributo antes de escribirlos.
  const guardarAtributos = useCallback(
    async (vista: VistaMiFicha, atributos: Record<string, number>) => {
      if (!token) {
        return;
      }
      setOcupada("atributos");
      setAviso(null);
      try {
        const r = await api.guardarAtributosDeMiFicha(
          token,
          vista.slug,
          atributos,
        );
        setDatos((actual) =>
          actual ? { ...actual, ficha: r.ficha } : actual,
        );
        setAviso({ tipo: "ok", texto: t("mificha.atrGuardado") });
      } catch (error_) {
        avisarFallo(error_);
      } finally {
        setOcupada(null);
      }
    },
    [token, t, avisarFallo],
  );

  const minecraft = useCallback(
    async (accion: "codigo" | "desvincular") => {
      if (!token || !datos) {
        return;
      }
      setOcupada("minecraft");
      setAviso(null);
      try {
        const r = await api.minecraftDeMiFicha(token, datos.ficha.slug, accion);
        setDatos((actual) =>
          actual ? { ...actual, ficha: r.ficha } : actual,
        );
        setCodigoMinecraft(r.codigo?.codigo ?? null);
        if (accion === "desvincular") {
          setAviso({ tipo: "ok", texto: t("mificha.minecraftDesvinculado") });
        }
      } catch (error_) {
        avisarFallo(error_);
      } finally {
        setOcupada(null);
      }
    },
    [token, datos, t, avisarFallo],
  );

  const reclamarGrado = useCallback(
    async (mision: string, grado: string) => {
      if (!token || !datos) {
        return;
      }
      setOcupada(mision);
      setAviso(null);
      try {
        const r = await api.reclamarGradoDeMision(
          token,
          datos.ficha.slug,
          mision,
        );
        setDatos((actual) =>
          actual ? { ...actual, ficha: r.ficha } : actual,
        );
        setAviso({
          tipo: "ok",
          texto: t("mificha.misionesReclamado", { grado }),
        });
      } catch (error_) {
        avisarFallo(error_);
      } finally {
        setOcupada(null);
      }
    },
    [token, datos, t, avisarFallo],
  );

  const subirStat = useCallback(
    (slug: string, nombre: string) => void aplicar("subir-stat", slug, nombre),
    [aplicar],
  );
  const reiniciarStats = useCallback(
    () => void aplicar("reiniciar-stats"),
    [aplicar],
  );
  const pedirCodigo = useCallback(() => void minecraft("codigo"), [minecraft]);
  const desvincular = useCallback(
    () => void minecraft("desvincular"),
    [minecraft],
  );
  const reclamar = useCallback(
    (mision: string, grado: string) => void reclamarGrado(mision, grado),
    [reclamarGrado],
  );
  const elegirFicha = useCallback(
    (slug: string) => {
      setCodigoMinecraft(null);
      if (token) {
        void cargar(token, slug);
      }
    },
    [token, cargar],
  );
  const subir = useCallback(
    (clave: string, nombre: string) => void aplicar("subir", clave, nombre),
    [aplicar],
  );
  const reiniciar = useCallback(() => void aplicar("reiniciar"), [aplicar]);
  const convertir = useCallback(
    () => void aplicar(CONVERTIR_SOBRANTES),
    [aplicar],
  );
  const guardar = useCallback(
    (vista: VistaMiFicha, atributos: Record<string, number>) =>
      void guardarAtributos(vista, atributos),
    [guardarAtributos],
  );

  if (!listo) {
    return <p className="text-sm text-dex-muted">{t("mificha.cargando")}</p>;
  }
  if (!token) {
    return <PedirEnlace />;
  }
  if (error?.tipo === "caducado") {
    return <PedirEnlace aviso={t("mificha.enlaceCaducado")} />;
  }
  if (error?.tipo === "sin_fichas") {
    return <Aviso tipo="error">{t("mificha.sinFichas")}</Aviso>;
  }
  if (error) {
    return <Aviso tipo="error">{t("mificha.error")}</Aviso>;
  }
  if (!datos) {
    return (
      <p className="text-sm text-dex-muted" data-testid="mificha-cargando">
        {t("mificha.cargando")}
      </p>
    );
  }

  return (
    <MiFichaVista
      datos={datos}
      ocupada={ocupada}
      aviso={aviso}
      confirmando={confirmando}
      confirmandoStats={confirmandoStats}
      alSubirStat={subirStat}
      alReiniciarStats={reiniciarStats}
      alConfirmarStats={setConfirmandoStats}
      codigoMinecraft={codigoMinecraft}
      alPedirCodigo={pedirCodigo}
      alDesvincular={desvincular}
      alReclamarGrado={reclamar}
      alElegirFicha={elegirFicha}
      alSubir={subir}
      alReiniciar={reiniciar}
      alConvertir={convertir}
      alGuardarAtributos={guardar}
      alConfirmar={setConfirmando}
    />
  );
}

/** Nombre, nivel y la barra de experiencia de la ficha elegida. */
function CabeceraDeFicha({ ficha }: Readonly<{ ficha: VistaMiFicha }>) {
  const { t } = useI18n();
  const falta = Math.max(0, ficha.experience.max - ficha.experience.current);
  const porcentaje = Math.min(
    100,
    Math.round(
      (ficha.experience.current / Math.max(1, ficha.experience.max)) * 100,
    ),
  );
  return (
    <section className="rounded-2xl border border-dex-line bg-dex-panel/70 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-extrabold text-dex-ink">{ficha.name}</h2>
        <span className="rounded-lg border border-dex-line px-2 py-0.5 font-mono text-xs text-dex-ink">
          {t("mificha.nivel", { n: ficha.level })}
        </span>
      </div>
      <div className="mt-3 flex justify-between text-[11px] uppercase tracking-[0.12em] text-dex-muted">
        <span>{t("atributos.experiencia")}</span>
        <span className="font-mono">
          {ficha.experience.current} / {ficha.experience.max}
        </span>
      </div>
      <div
        className="mt-1 h-2 w-full overflow-hidden rounded-full bg-white/10"
        role="progressbar"
        aria-label={t("atributos.experiencia")}
        aria-valuemin={0}
        aria-valuemax={ficha.experience.max}
        aria-valuenow={ficha.experience.current}
      >
        <div
          className="h-full rounded-full bg-dex-accent transition-[width] duration-500"
          style={{ width: `${porcentaje}%` }}
        />
      </div>
      <p className="mt-1.5 flex justify-between text-[11px] uppercase tracking-[0.12em] text-dex-muted">
        <span>{t("atributos.expTotal")}</span>
        <span className="font-mono" data-testid="mificha-total">
          {ficha.experience.total.toLocaleString()}
        </span>
      </p>
      <p className="mt-3 text-xs text-dex-muted">
        {t("mificha.siguienteNivel", { n: falta, sig: ficha.level + 1 })}
      </p>
    </section>
  );
}

/** «Puntos para repartir» en palabras: cero dice cómo se ganan, uno y varios se cuentan. */
function textoDePuntos(t: Traducir, puntos: VistaMiFicha["puntos"]): string {
  if (puntos.disponibles === 0) {
    return t("mificha.puntosCero", { por: puntos.puntosPorNivel });
  }
  if (puntos.disponibles === 1) {
    return t("mificha.puntosUno");
  }
  return t("mificha.puntosVarios", { n: puntos.disponibles });
}

/** El número grande de puntos de habilidad disponibles. */
function ResumenDePuntos({
  puntos,
}: Readonly<{ puntos: VistaMiFicha["puntos"] }>) {
  const { t } = useI18n();
  return (
    <section
      className="rounded-2xl border border-dex-accent/40 bg-dex-accent/10 p-5"
      aria-live="polite"
    >
      <p className="text-xs uppercase tracking-[0.14em] text-dex-muted">
        {t("mificha.puntosTitulo")}
      </p>
      <p
        className="mt-1 text-5xl font-extrabold text-dex-ink"
        data-testid="mificha-disponibles"
      >
        {puntos.disponibles}
      </p>
      <p className="mt-2 text-sm text-dex-ink/85">{textoDePuntos(t, puntos)}</p>
      <p className="mt-1 text-xs text-dex-muted">
        {t("mificha.resumen", { a: puntos.repartidos, b: puntos.ganados })}
      </p>
    </section>
  );
}

/** Los puntos que sobran (más de los que caben en las habilidades) y el botón que los pasa a stats. */
function Sobrantes({
  n,
  ocupada,
  alConvertir,
}: Readonly<{ n: number; ocupada: string | null; alConvertir: () => void }>) {
  const { t } = useI18n();
  return (
    <section className="rounded-2xl border border-dex-accent/40 bg-dex-panel/60 p-5">
      <p className="text-sm text-dex-ink/85">
        {t("mificha.sobrantesTexto", { n })}
      </p>
      <button
        type="button"
        onClick={alConvertir}
        disabled={ocupada !== null}
        className={`mt-3 ${claseSecundario}`}
        data-testid="mificha-sobrantes"
      >
        {t("mificha.sobrantesBoton", { n })}
      </button>
    </section>
  );
}

/** Las habilidades agrupadas por categoría, cada una con su rango y su «+ Subir». */
function ListaDeHabilidades({
  puntos,
  ocupada,
  alSubir,
}: Readonly<{
  puntos: VistaMiFicha["puntos"];
  ocupada: string | null;
  alSubir: (clave: string, nombre: string) => void;
}>) {
  const { t } = useI18n();
  if (puntos.habilidades.length === 0) {
    return <p className="text-sm text-dex-muted">{t("mificha.sinHabilidades")}</p>;
  }
  return (
    <>
      {CATEGORIAS.map((categoria) => {
        const lista = puntos.habilidades.filter(
          (h) => h.category === categoria,
        );
        if (!lista.length) {
          return null;
        }
        return (
          <section
            key={categoria}
            className="rounded-2xl border border-dex-line bg-dex-panel/60 p-5"
          >
            <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-dex-muted">
              {t(`mificha.categoria.${categoria}` as Clave)}
            </h3>
            <ul className="mt-3 space-y-2">
              {lista.map((h) => {
                const enMaximo = h.rango >= puntos.rangoMaximo;
                const puede = puntos.disponibles > 0 && !enMaximo;
                return (
                  <FilaSubible
                    key={h.clave}
                    testId="mificha-habilidad"
                    clave={h.clave}
                    nombre={h.name}
                    detalle={
                      <span className="mt-1 block">
                        <Rango
                          n={h.rango}
                          max={puntos.rangoMaximo}
                          etiqueta={t("mificha.rango", {
                            n: h.rango,
                            max: puntos.rangoMaximo,
                          })}
                        />
                      </span>
                    }
                    deshabilitado={!puede || ocupada !== null}
                    enMaximo={enMaximo}
                    subiendo={ocupada === h.clave}
                    alSubir={alSubir}
                  />
                );
              })}
            </ul>
          </section>
        );
      })}
    </>
  );
}

/** Devolver los puntos de habilidad repartidos: un botón que abre su «¿seguro?». */
function ReiniciarHabilidades({
  repartidos,
  confirmando,
  ocupada,
  alReiniciar,
  alConfirmar,
}: Readonly<{
  repartidos: number;
  confirmando: boolean;
  ocupada: string | null;
  alReiniciar: () => void;
  alConfirmar: (abierto: boolean) => void;
}>) {
  const { t } = useI18n();
  return (
    <div className="space-y-2">
      {confirmando ? (
        <ConfirmarReinicio
          texto={t("mificha.reiniciarConfirma", { n: repartidos })}
          ocupada={ocupada}
          alReiniciar={alReiniciar}
          alConfirmar={alConfirmar}
        />
      ) : (
        <>
          <button
            type="button"
            onClick={() => alConfirmar(true)}
            className={claseSecundario}
          >
            {t("mificha.reiniciar")}
          </button>
          <p className="text-xs text-dex-muted">
            {t("mificha.reiniciarAyuda")}
          </p>
        </>
      )}
    </div>
  );
}

/**
 * La pantalla de «Mi ficha», sin lógica: recibe los datos y avisa de lo que se pulsa. Así la usa también la página
 * explicativa `/niveles` como MAQUETA real (mismo código, datos de ejemplo): lo que se explica es lo que se verá.
 */
export function MiFichaVista({
  datos,
  ocupada = null,
  aviso = null,
  confirmando = false,
  confirmandoStats = false,
  alSubirStat = () => {},
  alReiniciarStats = () => {},
  alConfirmarStats = () => {},
  codigoMinecraft = null,
  alPedirCodigo = () => {},
  alDesvincular = () => {},
  alReclamarGrado = () => {},
  alElegirFicha = () => {},
  alSubir = () => {},
  alReiniciar = () => {},
  alConfirmar = () => {},
  alConvertir = () => {},
  alGuardarAtributos = () => {},
}: Readonly<{
  datos: RespuestaMiFicha;
  ocupada?: string | null;
  aviso?: { tipo: "ok" | "error"; texto: string } | null;
  confirmando?: boolean;
  confirmandoStats?: boolean;
  alSubirStat?: (slug: string, nombre: string) => void;
  alReiniciarStats?: () => void;
  alConfirmarStats?: (abierto: boolean) => void;
  codigoMinecraft?: string | null;
  alPedirCodigo?: () => void;
  alDesvincular?: () => void;
  alReclamarGrado?: (mision: string, grado: string) => void;
  alElegirFicha?: (slug: string) => void;
  alSubir?: (clave: string, nombre: string) => void;
  alReiniciar?: () => void;
  alConfirmar?: (abierto: boolean) => void;
  alConvertir?: () => void;
  alGuardarAtributos?: (
    ficha: VistaMiFicha,
    atributos: Record<string, number>,
  ) => void;
}>) {
  const { t } = useI18n();
  const { ficha, fichas } = datos;
  const { puntos } = ficha;
  const sobrantes = puntos.sobrantes ?? 0;
  const elegirFicha = (e: React.ChangeEvent<HTMLSelectElement>) =>
    alElegirFicha(e.target.value);
  const guardarAtributos = useCallback(
    (atributos: Record<string, number>) => alGuardarAtributos(ficha, atributos),
    [alGuardarAtributos, ficha],
  );

  return (
    <div className="space-y-6" data-testid="mificha">
      {fichas.length > 1 && (
        <label className={claseEtiqueta}>
          {t("mificha.queFicha")}
          <select
            className={claseInput}
            value={ficha.slug}
            onChange={elegirFicha}
          >
            {fichas.map((f) => (
              <option key={f.slug} value={f.slug}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <CabeceraDeFicha ficha={ficha} />
      <ResumenDePuntos puntos={puntos} />

      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}

      {sobrantes > 0 && (
        <Sobrantes n={sobrantes} ocupada={ocupada} alConvertir={alConvertir} />
      )}

      {ficha.statsPuntos && (
        <SeccionStats
          estado={ficha.statsPuntos}
          ocupada={ocupada}
          confirmando={confirmandoStats}
          alSubir={alSubirStat}
          alReiniciar={alReiniciarStats}
          alConfirmar={alConfirmarStats}
        />
      )}

      {ficha.atributos && (
        <AtributosPanel
          estado={ficha.atributos}
          ocupada={ocupada}
          alGuardar={guardarAtributos}
        />
      )}

      <ListaDeHabilidades puntos={puntos} ocupada={ocupada} alSubir={alSubir} />

      {puntos.repartidos > 0 && (
        <ReiniciarHabilidades
          repartidos={puntos.repartidos}
          confirmando={confirmando}
          ocupada={ocupada}
          alReiniciar={alReiniciar}
          alConfirmar={alConfirmar}
        />
      )}

      {ficha.minecraft && (
        <SeccionMinecraft
          estado={ficha.minecraft}
          codigo={codigoMinecraft}
          ocupada={ocupada}
          alPedirCodigo={alPedirCodigo}
          alDesvincular={alDesvincular}
        />
      )}

      {ficha.misiones && (
        <SeccionMisiones
          misiones={ficha.misiones}
          ocupada={ocupada}
          alReclamar={alReclamarGrado}
        />
      )}

      <Link
        href={`/v/${ficha.slug}`}
        className="inline-block text-sm text-dex-accent underline underline-offset-2"
      >
        {t("mificha.verFicha")}
      </Link>
    </div>
  );
}

export default MiFicha;
