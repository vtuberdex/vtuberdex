'use client';
/**
 * Piezas visuales compartidas por el mantenedor. Viven aparte para que cada
 * sección del editor use EXACTAMENTE las mismas clases (antes cada campo copiaba
 * la cadena de Tailwind y se desalineaban al tocar una).
 */
import { useEffect, type ReactNode } from 'react';

export const inputClass =
  'mt-1 w-full rounded-lg border border-dex-line bg-dex-void px-3 py-2 text-sm normal-case text-dex-ink outline-none focus:border-dex-accent';

export const labelClass = 'block text-xs uppercase tracking-[0.14em] text-dex-muted';

export const ghostButton =
  'rounded-lg border border-dex-line px-2.5 py-1.5 text-xs text-dex-muted hover:text-dex-ink disabled:opacity-40 disabled:hover:text-dex-muted';

export const primaryButton = 'rounded-xl bg-dex-accent px-4 py-2 text-sm font-bold text-black disabled:opacity-50';

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className={labelClass}>
      {label}
      {children}
      {hint && <span className="mt-1 block text-[11px] normal-case tracking-normal text-dex-muted">{hint}</span>}
    </label>
  );
}

/** Ruta pública de un emblema (`images/faction/x.png` -> `/images/faction/x.png`). */
export function emblemSrc(icon: string | null | undefined): string | null {
  if (!icon) return null;
  return icon.startsWith('/') || /^https?:/i.test(icon) ? icon : `/${icon}`;
}

export function Emblem({ icon, className = 'h-5 w-5' }: { icon: string | null | undefined; className?: string }) {
  const src = emblemSrc(icon);
  if (!src) return <span className={`${className} inline-block rounded bg-white/5`} aria-hidden />;
  return <img src={src} alt="" className={`${className} object-contain`} />;
}

/**
 * Engarce oscuro del emblema, igual que el de la carta: la carta dibuja el emblema
 * como holograma por BRILLO del trazo sobre un fondo oscuro, así que mostrarlo sobre
 * un fondo claro engañaría (un trazo oscuro desaparece en la carta). Verlo aquí sobre
 * el engarce es la prueba de que se leerá bien.
 */
export function EmblemSocket({ icon, previewUrl, size = 96 }: { icon?: string | null; previewUrl?: string | null; size?: number }) {
  const src = previewUrl ?? emblemSrc(icon);
  return (
    <span
      data-testid="emblem-socket"
      className="relative flex shrink-0 items-center justify-center rounded-2xl ring-1 ring-white/10"
      style={{ width: size, height: size, background: 'radial-gradient(circle at 50% 40%, #1b1f2e 0%, #07080d 75%)' }}
    >
      {src ? (
        <img src={src} alt="" className="object-contain" style={{ width: size * 0.74, height: size * 0.74 }} />
      ) : (
        <span className="text-[10px] uppercase tracking-wide text-white/30">sin emblema</span>
      )}
    </span>
  );
}

/** Ventana modal accesible: foco en el diálogo, Escape y clic fuera para cerrar. */
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:items-center"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-xl rounded-2xl border border-dex-line bg-dex-void p-5 shadow-2xl">
        {children}
      </div>
    </div>
  );
}

/** Aviso con el motivo por el que una acción no está disponible (el botón deshabilitado nunca va mudo). */
export function Reason({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] text-amber-200/90" data-testid="reason">
      {children}
    </p>
  );
}
