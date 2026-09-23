'use client';
/**
 * Panel de ajuste EN VIVO de la carta 3D (banco de trabajo).
 *
 * POR QUÉ EXISTE
 * --------------
 * Afinar el efecto editando números y recargando es lento y engañoso: la carta flota y
 * se inclina sola, así que dos ajustes nunca se comparan en la misma pose. Con sliders
 * el cambio se ve al instante y sobre la misma carta.
 *
 * NO RE-RENDERIZA LA ESCENA
 * -------------------------
 * Los valores viven en el objeto mutable `live` (`card3d-live.ts`) y los lee el
 * `useFrame` de cada carta. Mover un slider NO entra en el estado de React: si entrara,
 * cada arrastre re-renderizaría la escena de R3F y con 8 cartas la grilla iría a
 * tirones, que es justo lo que impide juzgar el ajuste.
 *
 * SE ACTIVA CON `?tune=1`
 * -----------------------
 * Sin ese parámetro el panel no existe y la app se comporta igual que siempre. Es un
 * banco de trabajo, no una función del producto, así que no se muestra por defecto ni
 * añade peso al bundle normal (el componente se carga solo si el parámetro está).
 *
 * AL TERMINAR
 * -----------
 * El botón copia al portapapeles SOLO los valores movidos, con la ruta de la config,
 * para pegarlos a mano en `card3d-config.ts`. No escribe el archivo desde el navegador
 * a propósito: un panel de trabajo que edita el código fuente es una vía de sorpresas.
 */
import { useCallback, useState } from 'react';

import { GRUPOS, KNOBS, type Grupo, type LiveKnobs, cambios, live, resetLive, setKnob } from '@/components/card3d-live';

export function Card3dTuner() {
  const [abierto, setAbierto] = useState(true);
  /**
   * Contador que NO se lee: existe solo para forzar el repintado de los sliders
   * tras "reiniciar" y al mover una perilla. Los valores viven fuera de React
   * (`card3d-live`), así que sin un cambio de estado el panel mostraría números
   * viejos. Se marca con `_` para que el linter no lo lea como descuido.
   */
  const [_version, setVersion] = useState(0);

  const mover = useCallback((clave: keyof LiveKnobs, valor: number) => {
    setKnob(clave, valor);
    // Re-render solo del PANEL (para ver el número), no de la escena: la carta lee
    // `live` en su propio frame y no está suscrita a este estado.
    setVersion((v) => v + 1);
  }, []);

  const reiniciar = useCallback(() => {
    resetLive();
    setVersion((v) => v + 1);
  }, []);

  const movidos = cambios();
  const hayCambios = Object.keys(movidos).length > 0;

  /** Texto para pegar en `card3d-config.ts`. */
  const comoConfig = KNOBS.filter((k) => k.key in movidos)
    .map((k) => `${k.config}: ${movidos[k.key]}`)
    .join('\n');

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[42rem] max-w-[95vw] rounded-2xl border border-dex-line bg-dex-panel/95 p-4 text-xs shadow-2xl backdrop-blur">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center justify-between font-bold text-dex-ink"
      >
        <span>Ajuste en vivo</span>
        <span className="text-dex-muted">{abierto ? '▾' : '▸'}</span>
      </button>

      {abierto && (
        <div className="mt-3 space-y-3">
          <p className="text-[11px] leading-snug text-dex-muted">
            Los valores arrancan en los de <code>card3d-config.ts</code>. Al terminar,
            copia solo los movidos.
          </p>

          {/**
           * DOS COLUMNAS: personaje a la izquierda, fondo a la derecha. Son efectos
           * independientes (uno por capa), así que mezclarlos en una lista única
           * obligaba a leer la etiqueta para saber cuál manda sobre qué. En pantalla
           * estrecha se apilan solas con el `grid` responsivo.
           */}
          <div className="grid gap-4 md:grid-cols-2">
            {GRUPOS.map((g) => (
              <div key={g.id} className="min-w-0">
                <p className="mb-2 border-b border-dex-line pb-1 font-bold text-dex-ink">
                  {g.titulo}
                </p>
                <p className="mb-2 text-[10px] leading-tight text-dex-muted">{g.nota}</p>
                <div className="dex-scroll max-h-[52vh] space-y-3 overflow-y-auto pr-1">
                  {KNOBS.filter((k) => k.grupo === (g.id as Grupo)).map((knob) => (
                    <label key={knob.key} className="block">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="text-dex-ink">{knob.label}</span>
                        <span className="font-mono text-dex-accent">{live[knob.key]}</span>
                      </span>
                      <input
                        type="range"
                        min={knob.min}
                        max={knob.max}
                        step={knob.step}
                        value={live[knob.key]}
                        aria-label={`${g.titulo}: ${knob.label}`}
                        onChange={(e) => mover(knob.key, Number(e.target.value))}
                        className="mt-1 w-full accent-dex-accent"
                      />
                      <span className="mt-0.5 block text-[10px] leading-tight text-dex-muted">
                        {knob.hint}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={reiniciar}
              className="flex-1 rounded-lg border border-dex-line px-2 py-1.5 text-dex-muted hover:text-dex-ink"
            >
              Reiniciar
            </button>
            <button
              type="button"
              disabled={!hayCambios}
              onClick={() => void navigator.clipboard.writeText(comoConfig)}
              className="flex-1 rounded-lg border border-dex-accent/60 px-2 py-1.5 text-dex-accent disabled:opacity-40"
            >
              {hayCambios ? `Copiar ${Object.keys(movidos).length}` : 'Sin cambios'}
            </button>
          </div>

          {hayCambios && (
            <pre className="max-h-32 overflow-auto rounded-lg bg-black/40 p-2 font-mono text-[10px] text-dex-muted">
              {comoConfig}
            </pre>
          )}

          <p className="text-[10px] leading-tight text-dex-muted">
            Los números del GLSL (paleta del espectro, patrón del foil, geometría) NO
            están aquí: van compilados en el shader y moverlos obligaría a recompilar.
            Esos se ajustan en el archivo.
          </p>
        </div>
      )}
    </div>
  );
}
