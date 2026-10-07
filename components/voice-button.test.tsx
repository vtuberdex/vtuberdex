import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CLAVE_SILENCIO, VoiceButton } from '@/components/voice-button';

const play = vi.fn(() => Promise.resolve());
const pause = vi.fn();

function conClip(existe: boolean) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: existe } as Response)));
}

beforeEach(() => {
  window.localStorage.clear();
  play.mockClear();
  pause.mockClear();
  Object.defineProperty(window.HTMLMediaElement.prototype, 'play', { configurable: true, value: play });
  Object.defineProperty(window.HTMLMediaElement.prototype, 'pause', { configurable: true, value: pause });
});
afterEach(() => vi.unstubAllGlobals());

describe('VoiceButton', () => {
  it('no se muestra si la ficha no tiene clip', async () => {
    conClip(false);
    render(<VoiceButton slug="sin-voz" />);
    await act(async () => undefined);
    expect(screen.queryByTestId('voz-boton')).not.toBeInTheDocument();
    expect(play).not.toHaveBeenCalled();
  });

  it('con clip: aparece, pide el HEAD del slug y suena sola', async () => {
    conClip(true);
    render(<VoiceButton slug="madkoding" />);
    expect(await screen.findByTestId('voz-boton')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/voces/madkoding.mp3', { method: 'HEAD' });
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('voz-audio')).toHaveAttribute('src', '/voces/madkoding.mp3');
  });

  it('el parlantito silencia, corta el audio y recuerda la preferencia', async () => {
    conClip(true);
    render(<VoiceButton slug="madkoding" />);
    await screen.findByTestId('voz-boton');
    await waitFor(() => expect(play).toHaveBeenCalled());
    fireEvent.play(screen.getByTestId('voz-audio')); // el navegador avisa que ya suena
    fireEvent.click(screen.getByRole('button', { name: /Silenciar/ }));
    expect(pause).toHaveBeenCalled();
    expect(window.localStorage.getItem(CLAVE_SILENCIO)).toBe('1');
    expect(screen.getByTestId('voz-boton')).toHaveAttribute('aria-pressed', 'true');
  });

  it('con la preferencia de silencio guardada NO arranca sola, y un clic la reproduce', async () => {
    window.localStorage.setItem(CLAVE_SILENCIO, '1');
    conClip(true);
    render(<VoiceButton slug="madkoding" />);
    await screen.findByTestId('voz-boton');
    expect(play).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('voz-boton'));
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    expect(window.localStorage.getItem(CLAVE_SILENCIO)).toBe('0');
  });

  it('si el navegador bloquea la reproducción automática, queda en «Escuchar» y no falla', async () => {
    play.mockImplementationOnce(() => Promise.reject(new DOMException('bloqueado', 'NotAllowedError')));
    conClip(true);
    render(<VoiceButton slug="madkoding" />);
    const boton = await screen.findByTestId('voz-boton');
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    expect(boton).toHaveTextContent('Escuchar');
    fireEvent.click(boton);
    await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
  });

  it('al salir de la ficha se detiene el audio', async () => {
    conClip(true);
    const { unmount } = render(<VoiceButton slug="madkoding" />);
    await screen.findByTestId('voz-boton');
    await waitFor(() => expect(play).toHaveBeenCalled());
    pause.mockClear();
    unmount();
    expect(pause).toHaveBeenCalled();
  });
});
