import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PremiumRates } from '@/components/admin/premium-rates';

describe('PremiumRates', () => {
  it('muestra 20 USD en 9.5, la Black Label reservada y el resto por definir', () => {
    render(<PremiumRates />);
    expect(screen.getByTestId('tarifa-9.5').textContent).toContain('20 USD');
    expect(screen.getByTestId('tarifa-BL').textContent).toContain('Reservada');
    expect(screen.getByTestId('tarifa-8').textContent).toContain('Por definir');
  });
});
