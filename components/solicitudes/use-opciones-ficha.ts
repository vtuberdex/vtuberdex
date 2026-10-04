'use client';
/**
 * Países e idiomas que ofrecen los formularios públicos, sacados de las facetas del catálogo. Si la API
 * no responde, el formulario sigue siendo utilizable (idiomas de respaldo y país como texto libre).
 */
import { useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { DEFAULT_SEARCH } from '@/lib/query';
import { facetValue } from '@/lib/types';

export interface Opcion {
  value: string;
  label: string;
}

const IDIOMAS_RESPALDO: Opcion[] = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'Inglés' },
  { value: 'pt', label: 'Portugués' },
];

export function useOpcionesFicha() {
  const [paises, setPaises] = useState<Opcion[]>([]);
  const [idiomas, setIdiomas] = useState<Opcion[]>(IDIOMAS_RESPALDO);

  useEffect(() => {
    api
      .list({ ...DEFAULT_SEARCH, perPage: 1 })
      .then((respuesta) => {
        setPaises((respuesta.facets?.countries ?? []).map((b) => ({ value: facetValue(b), label: b.name })));
        const delServidor = (respuesta.facets?.languages ?? []).map((b) => ({ value: facetValue(b), label: b.name }));
        if (delServidor.length) setIdiomas(delServidor);
      })
      .catch(() => undefined);
  }, []);

  return { paises, idiomas };
}
