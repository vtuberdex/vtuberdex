'use client';
/**
 * Pestaña «Dados» del mantenedor: el admin tira los dados de la partida (por ejemplo la X de una
 * Ultimate «Lanza 2d6») en vez de que la decida una herramienta por su cuenta.
 *
 * El resultado sale de `tirar` (azar criptográfico del navegador, sin sesgo) en el momento de pulsar,
 * y la escena anima hasta ESA cara. Se muestra cuando los dados terminan de rodar: la duración es
 * conocida (`DADOS`), así que el panel no depende de que la escena le avise (y se prueba sin WebGL).
 * La escena se monta tras hidratar y solo con la pestaña abierta: un canvas por pantalla.
 */
import { useEffect, useRef, useState } from 'react';

import {
  CARAS,
  DADOS,
  TIPOS_DE_DADO,
  expresionDe,
  tirar,
  type TipoDeDado,
} from '@/components/dados/dados-geometria';
import { EscenaDados, type DadoEnMesa } from '@/components/dados/escena-dados';
import { FRACCION_DEL_DADO, type CarasDelDado } from '@/components/admin/kit-habilidades';
import { ghostButton, primaryButton } from '@/components/admin/ui';

interface Tirada {
  id: number;
  dados: DadoEnMesa[];
  revelada: boolean;
}

interface Registro {
  id: number;
  expresion: string;
  valores: Array<{ tipo: TipoDeDado; valor: number }>;
  total: number;
  hora: string;
}

/** Atajos de la fórmula de dado de la Ultimate (`kit-habilidades.ts`): X = la suma. */
const ATAJOS_ULTIMATE: Array<{ dados: 1 | 2; caras: CarasDelDado }> = (['4', '6', '8'] as CarasDelDado[]).flatMap((caras) => [
  { dados: 1 as const, caras },
  { dados: 2 as const, caras },
]);

const MAX_HISTORIAL = 8;

export function DadosPanel() {
  const [montado, setMontado] = useState(false);
  const [bandeja, setBandeja] = useState<TipoDeDado[]>(['d6', 'd6']);
  const [tirada, setTirada] = useState<Tirada | null>(null);
  const [historial, setHistorial] = useState<Registro[]>([]);
  const [semillaMesa, setSemillaMesa] = useState(1);
  /** La fórmula de Ultimate de la última tirada por atajo, para decir cuánto vale cada ataque. */
  const [atajo, setAtajo] = useState<CarasDelDado | null>(null);
  const contador = useRef(0);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setMontado(true), []);
  useEffect(() => () => {
    if (temporizador.current) clearTimeout(temporizador.current);
  }, []);

  const rodando = tirada !== null && !tirada.revelada;

  const cambiarBandeja = (siguiente: TipoDeDado[]) => {
    setBandeja(siguiente);
    setTirada(null);
    setAtajo(null);
  };

  const lanzar = (tipos: TipoDeDado[], deAtajo: CarasDelDado | null = null) => {
    if (!tipos.length) return;
    const id = ++contador.current;
    const dados: DadoEnMesa[] = tipos.map((tipo, i) => ({
      clave: `${id}-${i}`,
      tipo,
      valor: tirar(CARAS[tipo]),
      // La semilla solo decide el tumbo y el humo (lo visual): el número ya está decidido arriba.
      semilla: Math.random() * 1000,
      animar: true,
    }));
    setBandeja(tipos);
    setAtajo(deAtajo);
    setSemillaMesa(Math.random() * 1000);
    setTirada({ id, dados, revelada: false });
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => {
      setTirada((actual) => (actual?.id === id ? { ...actual, revelada: true } : actual));
      const valores = dados.map((d) => ({ tipo: d.tipo, valor: d.valor }));
      setHistorial((h) =>
        [{ id, expresion: expresionDe(tipos), valores, total: valores.reduce((s, v) => s + v.valor, 0), hora: new Date().toLocaleTimeString('es-CL') }, ...h].slice(
          0,
          MAX_HISTORIAL,
        ),
      );
    }, DADOS.duracionMs + DADOS.variacionMs + 150);
  };

  // Antes de tirar, la bandeja muestra los dados en reposo con su número más alto arriba.
  const enMesa: DadoEnMesa[] =
    tirada?.dados ??
    bandeja.map((tipo, i) => ({ clave: `vista-${i}-${tipo}`, tipo, valor: CARAS[tipo], semilla: i * 7.3 + 1, animar: false }));

  const total = tirada?.dados.reduce((s, d) => s + d.valor, 0) ?? 0;

  return (
    <section className="space-y-4" data-testid="dados-panel">
      <p className="text-sm text-dex-muted">
        Tira aquí los dados de la partida. El número sale del azar del navegador al pulsar «Tirar» y los dados ruedan hasta caer en
        esa cara.
      </p>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="relative aspect-[16/10] w-full overflow-hidden rounded-2xl border border-dex-line bg-[#07080d]">
          {/* El canvas va en una caja posicionada: medirse a sí mismo le impediría encoger (ver AGENTS.md). */}
          <div className="absolute inset-0">{montado && <EscenaDados dados={enMesa} semillaMesa={semillaMesa} />}</div>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-[0.14em] text-dex-muted">Agregar a la bandeja</h4>
            <div className="flex flex-wrap gap-1.5">
              {TIPOS_DE_DADO.map((tipo) => (
                <button
                  key={tipo}
                  type="button"
                  className={ghostButton}
                  disabled={rodando || bandeja.length >= DADOS.maximo}
                  onClick={() => cambiarBandeja([...bandeja, tipo])}
                >
                  + {tipo}
                </button>
              ))}
            </div>
            {bandeja.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5" aria-label="Dados en la bandeja">
                {bandeja.map((tipo, i) => (
                  <li key={`${tipo}-${i}`}>
                    <button
                      type="button"
                      disabled={rodando}
                      onClick={() => cambiarBandeja(bandeja.filter((_, j) => j !== i))}
                      aria-label={`Quitar ${tipo}`}
                      className="rounded-full border border-dex-line bg-black/30 px-2.5 py-0.5 font-mono text-xs text-dex-ink hover:border-red-400/60 disabled:opacity-50"
                    >
                      {tipo} ✕
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-dex-muted">La bandeja está vacía.</p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={`${primaryButton} min-w-36`} disabled={rodando || bandeja.length === 0} onClick={() => lanzar(bandeja)}>
                {rodando ? 'Rodando…' : bandeja.length ? `Tirar ${expresionDe(bandeja)}` : 'Tirar'}
              </button>
              <button type="button" className={ghostButton} disabled={rodando || bandeja.length === 0} onClick={() => cambiarBandeja([])}>
                Vaciar
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-[0.14em] text-dex-muted">Dado de la Ultimate</h4>
            <div className="flex flex-wrap gap-1.5">
              {ATAJOS_ULTIMATE.map(({ dados, caras }) => (
                <button
                  key={`${dados}d${caras}`}
                  type="button"
                  className={ghostButton}
                  disabled={rodando}
                  title={`X ataques de ${FRACCION_DEL_DADO[caras]} del ataque`}
                  onClick={() => lanzar(Array.from({ length: dados }, () => `d${caras}` as TipoDeDado), caras)}
                >
                  {dados}d{caras}
                </button>
              ))}
            </div>
          </div>

          <div aria-live="polite" className="min-h-24 rounded-xl border border-dex-line bg-black/20 p-3" data-testid="dados-resultado">
            {!tirada && <p className="text-sm text-dex-muted">Pulsa «Tirar» para lanzar los dados.</p>}
            {rodando && <p className="text-sm text-dex-muted">Rodando…</p>}
            {tirada?.revelada && (
              <div className="space-y-2">
                <p className="text-3xl font-extrabold text-dex-ink" data-testid="dados-total">
                  {total}
                </p>
                <p className="text-xs text-dex-muted">{tirada.dados.map((d) => `${d.tipo}: ${d.valor}`).join(' · ')}</p>
                {atajo && (
                  <p className="text-xs text-dex-ink">
                    X = {total}: {total} {total === 1 ? 'ataque' : 'ataques'} de {FRACCION_DEL_DADO[atajo]} del ataque.
                  </p>
                )}
              </div>
            )}
          </div>

          {historial.length > 0 && (
            <div className="space-y-1">
              <h4 className="text-xs font-bold uppercase tracking-[0.14em] text-dex-muted">Últimas tiradas</h4>
              <ol className="space-y-0.5 font-mono text-[11px] text-dex-muted" data-testid="dados-historial">
                {historial.map((r) => (
                  <li key={r.id}>
                    {r.hora} · {r.expresion} → <span className="text-dex-ink">{r.total}</span> ({r.valores.map((v) => v.valor).join(', ')})
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
