/** Chip de país con bandera; tolera países sin bandera en el dataset. */
import type { CountryRef } from '@/lib/types';

const FALLBACK_FLAG = '🏳️';

export function CountryBadge({ country, showName = false }: { country: CountryRef; showName?: boolean }) {
  const flag = country.flag?.trim() || FALLBACK_FLAG;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md bg-black/45 px-1.5 py-0.5 text-[11px] font-semibold text-white/90"
      title={country.name}
    >
      <span aria-hidden>{flag}</span>
      {showName && <span className="truncate">{country.name}</span>}
      <span className="sr-only">{country.name}</span>
    </span>
  );
}

export default CountryBadge;
