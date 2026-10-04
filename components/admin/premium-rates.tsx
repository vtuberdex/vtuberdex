'use client';
/**
 * Tarifas de las cartas premium: cuánto hay que donar para llegar a cada grado.
 *
 * Es SOLO LECTURA a propósito: los montos viven en `DONACION_POR_GRADO` (`server/src/premium.mjs`),
 * junto a la escala, para que no haya dos tablas que discrepen. Un grado sin monto sale como
 * «Por definir» (no se inventa uno) y la Black Label como «Reservada»: no se obtiene donando.
 */
import { DONACION_POR_GRADO, GRADOS, GRADOS_RESERVADOS, nombreDeGrado } from '@/lib/premium';

export function PremiumRates() {
  return (
    <section className="max-w-xl" data-testid="premium-rates">
      <h2 className="text-lg font-bold text-dex-ink">Donación sugerida por grado</h2>
      <p className="mb-4 text-sm text-dex-muted">
        Cada dólar donado cubre un mes de racha, y lo acumulado da el grado. La carta sin donar se ve suelta, con un desgaste mínimo y sin placa. Es una referencia: el mantenedor registra la donación a mano.
      </p>
      <table className="w-full overflow-hidden rounded-xl border border-dex-line text-sm">
        <thead className="bg-dex-panel/60 text-left text-xs uppercase text-dex-muted">
          <tr>
            <th className="px-3 py-2">Grado</th>
            <th className="px-3 py-2">Nombre</th>
            <th className="px-3 py-2">Donación acumulada</th>
          </tr>
        </thead>
        <tbody>
          {GRADOS.map((grado) => {
            const monto = DONACION_POR_GRADO[grado];
            const reservado = GRADOS_RESERVADOS.includes(grado);
            return (
              <tr key={grado} className="border-t border-dex-line" data-testid={`tarifa-${grado}`}>
                <td className="px-3 py-2 font-semibold text-dex-ink">{grado}</td>
                <td className="px-3 py-2 text-dex-muted">{nombreDeGrado(grado)}</td>
                <td className="px-3 py-2 text-dex-ink">
                  {reservado ? 'Reservada' : monto == null ? <span className="text-dex-muted">Por definir</span> : `${monto} USD`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

export default PremiumRates;
