'use client';
/** Selector de idioma de la cabecera. Cada idioma se nombra en sí mismo (quien lo busca no lee el actual). */
import { useI18n } from '@/lib/i18n';
import { LOCALES, NOMBRE_PROPIO, esLocale } from '@/lib/i18n/locales';

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  return (
    <label className="ml-auto inline-flex items-center gap-2 text-xs text-dex-muted">
      <span className="sr-only">{t('idioma.selector')}</span>
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
        <path d="M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3Z" stroke="currentColor" strokeWidth="1.8" />
      </svg>
      <select
        value={locale}
        onChange={(event) => esLocale(event.target.value) && setLocale(event.target.value)}
        aria-label={t('idioma.selector')}
        data-testid="selector-idioma"
        className="rounded-lg border border-dex-line bg-dex-panel px-2 py-1.5 text-xs text-dex-ink outline-none focus:border-dex-accent"
      >
        {LOCALES.map((codigo) => (
          <option key={codigo} value={codigo} lang={codigo}>
            {NOMBRE_PROPIO[codigo]}
          </option>
        ))}
      </select>
    </label>
  );
}

export default LanguageSwitcher;
