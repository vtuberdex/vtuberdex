/**
 * Tests del gestor de imágenes del mantenedor.
 *
 * Se mockea el cliente de la API (no hay red en tests) y se comprueba lo que
 * importa de la UI: que se ofrezcan los cinco tipos, que "Subir" mande el archivo
 * elegido, que "Reemplazar" aparezca solo cuando ya hay imagen, y que los errores
 * se muestren en vez de fallar en silencio.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { ImageManager } from './ImageManager';
import { makeDetail } from '../../test/fixtures';

// El componente importa `api` del cliente real; se intercepta para no tocar red.
const uploadImage = vi.fn();
const deleteImage = vi.fn();
vi.mock('../../lib/api', () => ({
  api: {
    uploadImage: (...args: unknown[]) => uploadImage(...args),
    deleteImage: (...args: unknown[]) => deleteImage(...args),
  },
}));

afterEach(() => {
  vi.clearAllMocks();
});

/** Detalle con solo algunas imágenes, para probar ambos estados. */
function detailWithAssets() {
  return makeDetail({
    assets: [
      { kind: 'character', path: 'images/character/gkuro-monochrome.webp', sourceUrl: null, width: 252, height: 373, bytes: 40000 },
      { kind: 'logo', path: 'images/logo/gkuro-monochrome.webp', sourceUrl: null, width: 744, height: 359, bytes: 29860 },
    ],
  });
}

describe('ImageManager', () => {
  test('ofrece los tipos de imagen con su nombre correcto', () => {
    render(<ImageManager token="t" detail={detailWithAssets()} onUpdated={() => {}} />);
    // Solo TRES imágenes fuente: la CARTA no se lista (la compone el visor 3D en
    // el navegador) y la miniatura/radar se derivan, así que no se gestionan.
    for (const label of ['Personaje', 'Logo', 'Ficha']) {
      expect(screen.getByText(label), `debe ofrecer ${label}`).toBeTruthy();
    }
  });

  test('muestra las dimensiones de las imágenes que ya existen', () => {
    render(<ImageManager token="t" detail={detailWithAssets()} onUpdated={() => {}} />);
    expect(screen.getByText(/252×373/), 'dimensiones del personaje').toBeTruthy();
    expect(screen.getByText(/744×359/), 'dimensiones del logo').toBeTruthy();
  });

  test('un tipo sin fila de asset pero con ruta en images SÍ muestra imagen', () => {
    // El fixture trae `images` completo aunque solo 2 filas en `assets`: la ficha y
    // la miniatura existen en disco y no deben reportarse como "sin imagen".
    render(<ImageManager token="t" detail={detailWithAssets()} onUpdated={() => {}} />);
    expect(screen.queryByTestId('admin-image-card'), 'la ficha tiene vista previa').toBeTruthy();
    expect(screen.queryByTestId('admin-image-character')).toBeTruthy();
  });

  test('muestra "sin imagen" solo cuando no hay ruta en ninguna fuente', () => {
    const sinNada = makeDetail({
      assets: [],
      images: { card: null, thumb: null, logo: null, character: null, radar: null },
    });
    render(<ImageManager token="t" detail={sinNada} onUpdated={() => {}} />);
    expect(screen.getAllByText('sin imagen').length).toBe(3);
  });

  test('"Reemplazar" aparece cuando hay imagen y "Subir" cuando no hay', () => {
    const mixto = makeDetail({
      assets: [],
      images: { card: 'images/card/gkuro.webp', thumb: null, logo: 'images/logo/gkuro.webp', character: null, radar: null },
    });
    render(<ImageManager token="t" detail={mixto} onUpdated={() => {}} />);
    // Se buscan por rol de botón: el texto de ayuda de cada tarjeta también dice
    // "Reemplazar"/"Subir", así que contar solo por texto los mezclaría.
    const botones = screen.getAllByRole('button').map((b) => b.textContent);
    expect(botones.filter((t) => t === 'Reemplazar').length, 'ficha + logo').toBe(2);
    expect(botones.filter((t) => t === 'Subir').length, 'personaje').toBe(1);
  });

  test('subir manda el archivo elegido y refleja el resultado', async () => {
    const updated = detailWithAssets();
    uploadImage.mockResolvedValue({
      ok: true,
      kind: 'logo',
      asset: { path: 'images/logo/gkuro-monochrome.webp', width: 500, height: 200, bytes: 12345, format: 'webp', hasAlpha: true, alphaLost: false },
      vtuber: updated,
    });
    const onUpdated = vi.fn();
    render(<ImageManager token="tok" detail={detailWithAssets()} onUpdated={onUpdated} />);

    const input = screen.getByTestId('admin-input-logo') as HTMLInputElement;
    const file = new File(['datos'], 'mi-logo.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(uploadImage).toHaveBeenCalledTimes(1));
    // El token, el id y el tipo deben viajar correctos.
    expect(uploadImage.mock.calls[0][0]).toBe('tok');
    expect(uploadImage.mock.calls[0][1]).toBe(18);
    expect(uploadImage.mock.calls[0][2]).toBe('logo');
    expect(uploadImage.mock.calls[0][3]).toBe(file);
    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(updated));
    // Y se informa del resultado al usuario.
    expect(await screen.findByTestId('admin-images-message')).toBeTruthy();
    expect(screen.getByText(/500×200/), 'informa las dimensiones nuevas').toBeTruthy();
  });

  test('un error de subida se muestra, no se traga', async () => {
    uploadImage.mockRejectedValue(new Error('no_es_imagen'));
    render(<ImageManager token="tok" detail={detailWithAssets()} onUpdated={() => {}} />);
    fireEvent.change(screen.getByTestId('admin-input-card'), {
      target: { files: [new File(['x'], 'falso.png', { type: 'image/png' })] },
    });
    const msg = await screen.findByTestId('admin-images-message');
    expect(msg.textContent).toContain('no_es_imagen');
  });

  test('quitar borra la imagen y avisa', async () => {
    const updated = makeDetail({ assets: [] });
    deleteImage.mockResolvedValue({ ok: true, kind: 'logo', vtuber: updated });
    const onUpdated = vi.fn();
    render(<ImageManager token="tok" detail={detailWithAssets()} onUpdated={onUpdated} />);

    const botones = screen.getAllByText('Quitar');
    fireEvent.click(botones[0]);
    await waitFor(() => expect(deleteImage).toHaveBeenCalled());
    expect(deleteImage.mock.calls[0][2]).toBe('character');
    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(updated));
  });

  test('el input acepta cualquier imagen (la conversión la hace el servidor)', () => {
    render(<ImageManager token="t" detail={detailWithAssets()} onUpdated={() => {}} />);
    const input = screen.getByTestId('admin-input-character') as HTMLInputElement;
    expect(input.accept).toBe('image/*,.png,.jpg,.jpeg,.webp,.gif,.avif,.tif,.tiff,.svg');
    expect(input.type).toBe('file');
  });

  test('la vista previa usa una versión en la URL para no servir caché vieja', () => {
    render(<ImageManager token="t" detail={detailWithAssets()} onUpdated={() => {}} />);
    const img = screen.getByTestId('admin-image-logo') as HTMLImageElement;
    expect(img.src).toContain('images/logo/gkuro-monochrome.webp');
    expect(img.src).toMatch(/[?&]v=/);
  });
});
