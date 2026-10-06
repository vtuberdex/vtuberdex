'use client';
/**
 * Países e idiomas que ofrecen los formularios públicos, sacados de las facetas del catálogo. Si la API
 * no responde, el formulario sigue siendo utilizable (idiomas de respaldo y país como texto libre).
 */
import { useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { nombreDeIdioma } from '@/lib/i18n/nombres';
import { DEFAULT_SEARCH } from '@/lib/query';
import { facetValue } from '@/lib/types';

export interface Opcion {
  value: string;
  label: string;
}

/** Códigos de respaldo; el nombre se traduce al idioma activo (`ficha.idioma.<código>`). */
const CODIGOS_RESPALDO = ['es', 'en', 'pt'] as const;

export function useOpcionesFicha() {
  const { t, locale } = useI18n();
  const [paises, setPaises] = useState<Opcion[]>([]);
  const [delServidor, setDelServidor] = useState<Opcion[]>([]);

  useEffect(() => {
    api
      .list({ ...DEFAULT_SEARCH, perPage: 1 })
      .then((respuesta) => {
        setPaises((respuesta.facets?.countries ?? []).map((b) => ({ value: facetValue(b), label: b.name })));
        setDelServidor((respuesta.facets?.languages ?? []).map((b) => ({ value: facetValue(b), label: b.name })));
      })
      .catch(() => undefined);
  }, []);

  const idiomas: Opcion[] = delServidor.length
    ? delServidor.map((o) => ({ value: o.value, label: nombreDeIdioma(locale, o.value, o.label) }))
    : CODIGOS_RESPALDO.map((c) => ({ value: c, label: t(`ficha.idioma.${c}`) }));
  return { paises, idiomas };
}
