/**
 * DDL perezoso por ejecutor: cada módulo con tablas propias (solicitudes, borradores, likes…)
 * crea las suyas la primera vez que las toca, sin un paso de migración aparte.
 *
 * Se memoiza como PROMESA por ejecutor (dos peticiones a la vez esperan el mismo `exec`); si
 * falla se suelta, para no dejar rotas las lecturas siguientes. Sin dependencias: lo importan
 * tanto el servidor como las rutas de `lib/`.
 */
export function preparadorDeTablas(ddl) {
  const tablasListas = new WeakMap();
  return async function conTablas(ejecutor) {
    if (!tablasListas.has(ejecutor)) {
      const promesa = Promise.resolve(ejecutor.exec(ddl)).catch((error) => {
        tablasListas.delete(ejecutor);
        throw error;
      });
      tablasListas.set(ejecutor, promesa);
    }
    await tablasListas.get(ejecutor);
    return ejecutor;
  };
}
