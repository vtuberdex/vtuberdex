"use client";
/**
 * Subida de una imagen (avatar o logo) en los formularios públicos de inscripción y modificación, en lugar
 * de pegar un enlace.
 *
 * Qué ve la persona: elige un archivo, el navegador lo convierte AL FORMATO DE LA CARTA y se lo muestra
 * exactamente como quedará (con su recorte), y lo sube en el acto. Cambiarla o quitarla es un clic. Lo que
 * sube NO es su archivo sino un WebP nuevo (sin EXIF ni ubicación): el servidor solo acepta ese formato y
 * ese tamaño (`server/src/imagenes-solicitud.mjs`). El archivo original no sale de su equipo.
 *
 * El componente solo guarda el ID de la imagen subida (`id` / `onId`): es lo que viaja con el formulario y
 * con el borrador. Si hay un id pero no una vista local (se recuperó un borrador), pide la vista previa al
 * servidor con la misma credencial; si la imagen ya caducó, borra el id y avisa.
 *
 * Este botón NO va dentro de un <label>: un label reenvía el clic a su primer control y activaría «Quitar».
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, api, type FormularioConImagenes } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { Clave } from "@/lib/i18n/mensajes";
import {
  ErrorDeImagen,
  normalizarImagenDeSolicitud,
  type TipoImagenSolicitud,
} from "@/lib/imagen-cliente";

type Fase = "vacia" | "preparando" | "subiendo" | "lista";

interface Props {
  formulario: FormularioConImagenes;
  /** La `sesion` (inscripción) o el `permiso` (modificación): la credencial con que se sube. */
  credencial: string;
  tipo: TipoImagenSolicitud;
  etiqueta: string;
  ayuda?: string;
  obligatorio?: boolean;
  /** Id de la imagen ya subida, o `""`. */
  id: string;
  onId: (id: string) => void;
  /** Marca el campo en rojo (le falta a la lista de faltantes). */
  invalido?: boolean;
  /** Ancla para que «Ir al campo» de la lista de faltantes lo enfoque. */
  campo: string;
}

export function SubidaImagen({
  formulario,
  credencial,
  tipo,
  etiqueta,
  ayuda,
  obligatorio = false,
  id,
  onId,
  invalido,
  campo,
}: Props) {
  const { t } = useI18n();
  const entrada = useRef<HTMLInputElement>(null);
  const [fase, setFase] = useState<Fase>(id ? "lista" : "vacia");
  const [vista, setVista] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** La vista local ya es la de `id` (no hace falta pedirla al servidor). */
  const vistaDe = useRef<string>("");

  // Las URL de objeto se liberan al cambiarlas y al desmontar.
  useEffect(
    () => () => {
      if (vista) URL.revokeObjectURL(vista);
    },
    [vista],
  );

  const mostrar = useCallback((blob: Blob) => {
    setVista(URL.createObjectURL(blob));
  }, []);

  // Borrador recuperado: hay id pero ninguna vista local → se pide al servidor.
  useEffect(() => {
    if (!id || vistaDe.current === id || !credencial) return;
    let vigente = true;
    void api.imagenDeSolicitud(formulario, credencial, id).then((blob) => {
      if (!vigente) return;
      if (blob) {
        vistaDe.current = id;
        mostrar(blob);
        setFase("lista");
      } else {
        onId("");
        setFase("vacia");
        setVista(null);
        setError(t("img.error.caducada"));
      }
    });
    return () => {
      vigente = false;
    };
  }, [id, credencial, formulario, mostrar, onId, t]);

  const elegir = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setFase("preparando");
    try {
      const webp = await normalizarImagenDeSolicitud(file, tipo);
      // La vista es del resultado final, no del archivo original: es lo que se va a ver en la carta.
      mostrar(webp);
      setFase("subiendo");
      const subida = await api.subirImagenDeSolicitud(
        formulario,
        credencial,
        tipo,
        webp,
      );
      vistaDe.current = subida.id;
      onId(subida.id);
      setFase("lista");
    } catch (causa) {
      setFase(id ? "lista" : "vacia");
      if (!id) setVista(null);
      setError(
        causa instanceof ErrorDeImagen
          ? t(`img.error.${causa.codigo}` as Clave)
          : t("img.error.subida", {
              detalle: causa instanceof ApiError ? causa.message : String(causa),
            }),
      );
    } finally {
      if (entrada.current) entrada.current.value = "";
    }
  };

  const quitar = () => {
    setError(null);
    vistaDe.current = "";
    setVista(null);
    setFase("vacia");
    onId("");
  };

  const ocupado = fase === "preparando" || fase === "subiendo";
  const tienePreview = vista !== null;
  const requisitos =
    tipo === "character" ? "img.requisitosPersonaje" : "img.requisitosLogo";

  return (
    <div data-campo={campo} aria-invalid={invalido ? true : undefined}>
      <span className="block text-xs uppercase tracking-[0.14em] text-dex-muted">
        {etiqueta}
        {obligatorio && (
          <span className="ml-1 text-rose-300" aria-hidden>
            *
          </span>
        )}
      </span>

      <div
        className={`mt-1 flex items-start gap-3 rounded-lg border bg-dex-void p-3 ${
          invalido ? "border-rose-400 bg-rose-400/5" : "border-dex-line"
        }`}
      >
        <div
          data-testid={`vista-${campo}`}
          className="flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-dex-line"
          style={{
            width: tipo === "character" ? 96 : 120,
            height: tipo === "character" ? 134 : 96,
            // Tablero: deja ver la transparencia del recorte.
            backgroundImage:
              "conic-gradient(#2a3140 25%, #1b212d 0 50%, #2a3140 0 75%, #1b212d 0)",
            backgroundSize: "12px 12px",
          }}
        >
          {tienePreview ? (
            <img
              src={vista}
              alt={t("img.vista", { nombre: etiqueta })}
              className="h-full w-full object-contain"
            />
          ) : null}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <p
            className="text-xs text-dex-muted"
            role="status"
            aria-live="polite"
            data-testid={`estado-${campo}`}
          >
            {fase === "preparando" && t("img.preparando")}
            {fase === "subiendo" && t("img.subiendo")}
            {fase === "lista" && t("img.lista")}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={ocupado}
              onClick={() => entrada.current?.click()}
              className="rounded-lg border border-dex-line bg-dex-panel px-3 py-1.5 text-xs text-dex-ink hover:border-dex-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {id ? t("img.cambiar") : t("img.elegir")}
            </button>
            {id && (
              <button
                type="button"
                disabled={ocupado}
                onClick={quitar}
                className="rounded-lg border border-dex-line px-3 py-1.5 text-xs text-dex-muted hover:text-dex-ink disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("img.quitar")}
              </button>
            )}
          </div>
          <input
            ref={entrada}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
            className="sr-only"
            tabIndex={-1}
            aria-label={etiqueta}
            data-testid={`archivo-${campo}`}
            onChange={(e) => void elegir(e.target.files?.[0])}
          />
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-1 text-[11px] normal-case tracking-normal text-rose-300"
        >
          {error}
        </p>
      )}
      <span className="mt-1 block text-[11px] normal-case tracking-normal text-dex-muted">
        {ayuda ? `${ayuda} ` : ""}
        {t(requisitos)}
      </span>
    </div>
  );
}
