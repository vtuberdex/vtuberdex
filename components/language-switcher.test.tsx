import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppFooter } from '@/components/app-footer';
import { LanguageSwitcher } from '@/components/language-switcher';
import { I18nProvider } from '@/lib/i18n';

function ver() {
  return render(
    <I18nProvider>
      <LanguageSwitcher />
      <AppFooter />
    </I18nProvider>,
  );
}

describe('idioma de la interfaz', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('sin preferencia ni navegador soportado, español', async () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['fr-FR']);
    ver();
    expect(await screen.findByText('Términos y Condiciones')).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('es');
  });

  it('detecta el idioma del navegador', async () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['ja-JP', 'en']);
    ver();
    expect(await screen.findByText('利用規約')).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('ja');
  });

  it('el selector cambia el idioma y lo recuerda por encima del navegador', async () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['ja']);
    const { unmount } = ver();
    await userEvent.selectOptions(screen.getByTestId('selector-idioma'), 'en');
    expect(await screen.findByText('Terms and Conditions')).toBeInTheDocument();
    unmount();
    ver();
    expect(await screen.findByText('Terms and Conditions')).toBeInTheDocument();
  });
});
