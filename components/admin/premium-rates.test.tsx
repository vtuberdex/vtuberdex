import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PremiumRates } from '@/components/admin/premium-rates';

describe('PremiumRates', () => {
  it('muestra 20 USD en el 9.5, 1 USD en el 6 y la Black Label reservada', () => {
    render(<PremiumRates />);
    expect(screen.getByTestId('tarifa-9.5').textContent).toContain('20 USD');
    expect(screen.getByTestId('tarifa-BL').textContent).toContain('Reservada');
    expect(screen.getByTestId('tarifa-6').textContent).toContain('1 USD');
    expect(screen.getByTestId('tarifa-10').textContent).toContain('50 USD');
  });
});
