/**
 * Piezas visuales compartidas por el mantenedor. Viven aparte para que cada
 * sección del editor use EXACTAMENTE las mismas clases (antes cada campo copiaba
 * la cadena de Tailwind y se desalineaban al tocar una).
 */
import type { ReactNode } from 'react';

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
