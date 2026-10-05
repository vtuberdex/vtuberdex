'use client';
/**
 * Contexto del idioma de la interfaz.
 *
 * Arranca SIEMPRE en español (es lo que renderiza el servidor y la primera pasada del cliente, así
 * que la hidratación no discrepa) y, ya hidratado, aplica la elección guardada o la del navegador
 * (`elegirLocale`). Sin proveedor, `useI18n` devuelve el español: los componentes y sus pruebas
 * funcionan sin envolver nada.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { BCP47, CLAVE_IDIOMA, LOCALE_POR_DEFECTO, elegirLocale, esLocale, type Locale } from './locales';
import { traducir, type Clave, type Variables } from './mensajes';

export interface ContextoI18n {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (clave: Clave, variables?: Variables) => string;
}

const porDefecto: ContextoI18n = {
  locale: LOCALE_POR_DEFECTO,
  setLocale: () => undefined,
  t: (clave, variables) => traducir(LOCALE_POR_DEFECTO, clave, variables),
};

const Contexto = createContext<ContextoI18n>(porDefecto);

function leerGuardado(): string | null {
  try {
    return window.localStorage.getItem(CLAVE_IDIOMA);
  } catch {
    return null;
  }
}

export function I18nProvider({ children, inicial }: { children: ReactNode; inicial?: Locale }) {
  const [locale, setLocaleEstado] = useState<Locale>(inicial ?? LOCALE_POR_DEFECTO);

  useEffect(() => {
    if (inicial) return;
    setLocaleEstado(elegirLocale(leerGuardado(), navigator.languages?.length ? navigator.languages : [navigator.language]));
  }, [inicial]);

  useEffect(() => {
    document.documentElement.lang = BCP47[locale];
  }, [locale]);

  const setLocale = useCallback((nuevo: Locale) => {
    if (!esLocale(nuevo)) return;
    setLocaleEstado(nuevo);
    try {
      window.localStorage.setItem(CLAVE_IDIOMA, nuevo);
    } catch {
      /* sin almacenamiento: la elección vale solo para esta visita */
    }
  }, []);

  const valor = useMemo<ContextoI18n>(
    () => ({ locale, setLocale, t: (clave, variables) => traducir(locale, clave, variables) }),
    [locale, setLocale],
  );
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export const useI18n = (): ContextoI18n => useContext(Contexto);
