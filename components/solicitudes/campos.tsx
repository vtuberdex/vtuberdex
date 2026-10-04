'use client';
/**
 * Piezas compartidas por los formularios públicos (inscripción y baja): mismas clases, mismo
 * campo trampa y MISMA casilla de términos, para que los dos exijan exactamente lo mismo.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';

export const claseInput =
  'mt-1 w-full rounded-lg border border-dex-line bg-dex-void px-3 py-2 text-sm normal-case tracking-normal text-dex-ink outline-none placeholder:text-dex-muted/60 focus:border-dex-accent';

export const claseEtiqueta = 'block text-xs uppercase tracking-[0.14em] text-dex-muted';

export const claseBoton =
  'rounded-xl bg-dex-accent px-5 py-2.5 text-sm font-bold text-black disabled:cursor-not-allowed disabled:opacity-50';

export function Campo({
  etiqueta,
  ayuda,
  obligatorio = false,
  confidencial = false,
  children,
}: {
  etiqueta: string;
  ayuda?: ReactNode;
  obligatorio?: boolean;
  /** Marca los datos que NO se publican (correo, nombre civil). */
  confidencial?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={claseEtiqueta}>
      <span>
        {etiqueta}
        {obligatorio && <span className="ml-1 text-rose-300" aria-hidden>*</span>}
        {confidencial && (
          <span className="ml-2 rounded border border-dex-line px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-dex-muted">
            confidencial · no se publica
          </span>
        )}
      </span>
      {children}
      {ayuda && <span className="mt-1 block text-[11px] normal-case tracking-normal text-dex-muted">{ayuda}</span>}
    </label>
  );
}

/**
 * Campo trampa para bots: fuera de pantalla y fuera del orden de tabulación. Una persona no lo
 * ve; un script que rellena todo lo que encuentra, sí. El servidor descarta en silencio el envío.
 */
export function CampoTrampa({ valor, alCambiar }: { valor: string; alCambiar: (v: string) => void }) {
  return (
    <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
      <label>
        No rellenar este campo
        <input type="text" name="website" tabIndex={-1} autoComplete="off" value={valor} onChange={(e) => alCambiar(e.target.value)} />
      </label>
    </div>
  );
}

/**
 * La casilla OBLIGATORIA de términos y condiciones. El texto vive en otra página (`/terminos`),
 * que se abre en pestaña nueva para no perder lo escrito. El servidor la vuelve a exigir.
 */
export function AceptaTerminos({
  marcada,
  alCambiar,
  idUnico,
}: {
  marcada: boolean;
  alCambiar: (v: boolean) => void;
  idUnico: string;
}) {
  return (
    <div className="rounded-xl border border-dex-line bg-dex-panel-soft/60 p-4">
      <div className="flex items-start gap-3">
        <input
          id={idUnico}
          type="checkbox"
          required
          checked={marcada}
          onChange={(e) => alCambiar(e.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-dex-accent)]"
        />
        <label htmlFor={idUnico} className="text-sm text-dex-ink">
          He leído y acepto los{' '}
          <Link href="/terminos" target="_blank" rel="noopener" className="text-dex-accent underline underline-offset-2">
            Términos y Condiciones
          </Link>
          , incluida la{' '}
          <Link href="/terminos#salida" target="_blank" rel="noopener" className="text-dex-accent underline underline-offset-2">
            cláusula de salida
          </Link>{' '}
          (una ficha dada de baja no se elimina: se degrada). <span className="text-rose-300">*</span>
        </label>
      </div>
    </div>
  );
}

export function Aviso({ tipo, children }: { tipo: 'error' | 'ok'; children: ReactNode }) {
  const color = tipo === 'error' ? 'border-rose-400/50 bg-rose-400/10 text-rose-100' : 'border-emerald-400/50 bg-emerald-400/10 text-emerald-100';
  return (
    <div role={tipo === 'error' ? 'alert' : 'status'} className={`rounded-xl border px-4 py-3 text-sm ${color}`}>
      {children}
    </div>
  );
}
