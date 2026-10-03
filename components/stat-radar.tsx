/**
 * Gráfico de telaraña de los atributos de combate.
 *
 * SVG puro, sin dependencias: son unos 40 elementos y no cambia con la interacción. Cada eje se
 * normaliza contra su propia referencia (ver `lib/radar.ts`), así que la FORMA dice dónde destaca
 * el VTuber, y el número junto a cada vértice dice cuánto. Los anillos son el 25, 50, 75 y 100 %
 * de la referencia.
 *
 * Los colores salen de la paleta de la ficha (`accent` rellena y perfila el polígono), igual que
 * las barras. El nombre del VTuber y los valores van en el `aria-label` para lectores de pantalla:
 * un SVG decorativo no le diría nada a quien no lo ve.
 */
import { poligono, puntoDeEje, verticesDeRadar, MIN_EJES } from '@/lib/radar';
import type { StatRow } from '@/lib/types';

const ANCHO = 380;
const ALTO = 340;
const CX = ANCHO / 2;
const CY = ALTO / 2 + 4;
const RADIO = 112;
const ANILLOS = [0.25, 0.5, 0.75, 1];

export function StatRadar({ stats, palette }: { stats: readonly StatRow[]; palette: { accent: string; secondary: string } }) {
  const vertices = verticesDeRadar(stats);
  if (vertices.length < MIN_EJES) return null;
  const n = vertices.length;
  const descripcion = vertices.map((v) => `${v.label} ${v.value}`).join(', ');

  return (
    <figure className="mt-4" data-testid="stat-radar">
      <svg viewBox={`0 0 ${ANCHO} ${ALTO}`} role="img" aria-label={`Gráfico de atributos: ${descripcion}`} className="mx-auto h-auto w-full max-w-[420px]">
        {/* Anillos: la red de la telaraña. */}
        {ANILLOS.map((anillo) => (
          <polygon
            key={anillo}
            points={poligono(Array(n).fill(anillo), RADIO, CX, CY)}
            fill="none"
            stroke="currentColor"
            strokeOpacity={anillo === 1 ? 0.35 : 0.15}
            strokeWidth={1}
            className="text-dex-muted"
          />
        ))}
        {/* Ejes, del centro a cada vértice. */}
        {vertices.map((v, i) => {
          const fin = puntoDeEje(i, n, RADIO, CX, CY);
          return <line key={v.slug} x1={CX} y1={CY} x2={fin.x} y2={fin.y} stroke="currentColor" strokeOpacity={0.15} className="text-dex-muted" />;
        })}
        {/* La forma del VTuber. */}
        <polygon
          points={poligono(
            vertices.map((v) => v.ratio),
            RADIO,
            CX,
            CY,
          )}
          fill={palette.accent}
          fillOpacity={0.28}
          stroke={palette.accent}
          strokeWidth={2}
          strokeLinejoin="round"
          data-testid="stat-radar-shape"
        />
        {vertices.map((v, i) => {
          const punto = puntoDeEje(i, n, RADIO * v.ratio, CX, CY);
          return <circle key={v.slug} cx={punto.x} cy={punto.y} r={3.2} fill={palette.secondary} stroke={palette.accent} strokeWidth={1.2} />;
        })}
        {/* Etiquetas: nombre corto y valor, fuera del anillo exterior. */}
        {vertices.map((v, i) => {
          const p = puntoDeEje(i, n, RADIO + 20, CX, CY);
          const ancla = Math.abs(p.x - CX) < 8 ? 'middle' : p.x < CX ? 'end' : 'start';
          return (
            <text key={v.slug} x={p.x} y={p.y} textAnchor={ancla} dominantBaseline="middle" className="fill-dex-muted" style={{ fontSize: 10, letterSpacing: '0.06em' }}>
              <tspan x={p.x} dy="-0.4em">
                {v.corto}
              </tspan>
              <tspan x={p.x} dy="1.25em" className="fill-dex-ink" style={{ fontSize: 12, fontWeight: 700 }}>
                {v.value}
              </tspan>
            </text>
          );
        })}
      </svg>
    </figure>
  );
}

export default StatRadar;
