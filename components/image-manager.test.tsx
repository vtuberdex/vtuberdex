/**
 * Tests del gestor de imágenes del mantenedor.
 *
 * Se mockea el cliente de la API (no hay red en tests) y se comprueba lo que
 * importa de la UI: que se ofrezcan los tipos soportados, que "Subir" mande el archivo
 * elegido, que "Reemplazar" aparezca solo cuando ya hay imagen, y que los errores
 * se muestren en vez de fallar en silencio.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { ImageManager } from '@/components/image-manager';
import { makeDetail } from '@/test/fixtures';

// El componente importa `api` del cliente real; se intercepta para no tocar red.
const uploadImage = vi.fn();
const deleteImage = vi.fn();
vi.mock('@/lib/api', () => ({
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
    // Solo DOS imágenes fuente: la CARTA no se lista (la compone el visor 3D en
    // el navegador), la miniatura/radar se derivan y la ficha apaisada se retiró
    // (era el respaldo de `character`, y los 785 lo tienen).
    for (const label of ['Personaje', 'Logo']) {
      expect(screen.getByText(label), `debe ofrecer ${label}`).toBeTruthy();
    }
    expect(screen.queryByText('Ficha'), 'la ficha ya no se gestiona').toBeNull();
  });

  test('muestra las dimensiones de las imágenes que ya existen', () => {
    render(<ImageManager token="t" detail={detailWithAssets()} onUpdated={() => {}} />);
    expect(screen.getByText(/252×373/), 'dimensiones del personaje').toBeTruthy();
    expect(screen.getByText(/744×359/), 'dimensiones del logo').toBeTruthy();
  });

  test('un tipo sin fila de asset pero con ruta en images SÍ muestra imagen', () => {
    // El fixture trae rutas en `images` aunque no haya fila en `assets` (el
    // personaje): una ruta existente NO debe reportarse como "sin imagen".
    render(<ImageManager token="t" detail={detailWithAssets()} onUpdated={() => {}} />);
    expect(screen.queryByTestId('admin-image-character'), 'el personaje tiene vista previa').toBeTruthy();
  });

  test('muestra "sin imagen" solo cuando no hay ruta en ninguna fuente', () => {
    const sinNada = makeDetail({
      assets: [],
      images: { card: null, thumb: null, logo: null, character: null, radar: null, background: null },
    });
    render(<ImageManager token="t" detail={sinNada} onUpdated={() => {}} />);
    // Se cuenta contra los tipos GESTIONADOS (cada uno tiene su botón de subir) y no
    // contra un número fijo: así añadir una imagen al mantenedor no obliga a
    // reescribir el test, que es lo que debe comprobar —que sin ruta en ninguna
    // fuente se avise en todas las tarjetas—.
    const botones = screen.getAllByRole('button').map((b) => b.textContent);
    const gestionados = botones.filter((t) => t === 'Subir' || t === 'Reemplazar').length;
    expect(gestionados).toBeGreaterThan(0);
    expect(screen.getAllByText('sin imagen').length).toBe(gestionados);
  });

  test('"Reemplazar" aparece cuando hay imagen y "Subir" cuando no hay', () => {
    const mixto = makeDetail({
      assets: [],
      images: { card: 'images/card/gkuro.webp', thumb: null, logo: 'images/logo/gkuro.webp', character: null, radar: null, background: null },
    });
    render(<ImageManager token="t" detail={mixto} onUpdated={() => {}} />);
    // Se buscan por rol de botón: el texto de ayuda de cada tarjeta también dice
    // "Reemplazar"/"Subir", así que contar solo por texto los mezclaría.
    const botones = screen.getAllByRole('button').map((b) => b.textContent);
    // Con imagen: solo el logo. Sin ella: el personaje y el fondo.
    expect(botones.filter((t) => t === 'Reemplazar').length, 'solo el logo').toBe(1);
    expect(botones.filter((t) => t === 'Subir').length, 'el personaje y el fondo').toBe(2);
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
    // Y se informa del resultado al usuario vía toast.
    expect(await screen.findByTestId('toast-ok')).toBeTruthy();
    expect(screen.getByText(/500×200/), 'informa las dimensiones nuevas').toBeTruthy();
  });

  test('el FONDO se puede subir como tipo propio', async () => {
    /**
     * El fondo es un tipo GESTIONADO más: tiene su tarjeta, su input y su vista
     * previa, y al subir viaja con `kind: 'background'` (no con el del personaje, que
     * es el error que dejaría la capa apuntando a la carpeta equivocada).
     */
    const updated = detailWithAssets();
    uploadImage.mockResolvedValue({
      ok: true,
      kind: 'background',
      asset: { path: 'images/background/gkuro.webp', width: 720, height: 1008, bytes: 5000, format: 'webp', hasAlpha: false, alphaLost: false },
      vtuber: updated,
    });
    render(<ImageManager token="tok" detail={detailWithAssets()} onUpdated={() => {}} />);

    const input = screen.getByTestId('admin-input-background') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['datos'], 'fondo.png', { type: 'image/png' })] } });

    await waitFor(() => expect(uploadImage).toHaveBeenCalledTimes(1));
    expect(uploadImage.mock.calls[0][2]).toBe('background');
    expect(await screen.findByText(/720×1008/), 'informa el lienzo de carta').toBeTruthy();
    // El toast de éxito aparece.
    expect(await screen.findByTestId('toast-ok')).toBeTruthy();
  });

  test('un error de subida se muestra en un toast, no se traga', async () => {
    uploadImage.mockRejectedValue(new Error('no_es_imagen'));
    render(<ImageManager token="tok" detail={detailWithAssets()} onUpdated={() => {}} />);
    fireEvent.change(screen.getByTestId('admin-input-character'), {
      target: { files: [new File(['x'], 'falso.png', { type: 'image/png' })] },
    });
    const msg = await screen.findByTestId('toast-error');
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

  /**
   * ESTE ES EL TEST QUE FALTABA, y su ausencia dejó pasar el fallo de producción.
   *
   * La ruta de producción devolvía `{ok, slug, kind, size}` en vez de `{ok, kind, asset,
   * vtuber}`. El componente hacía `onUpdated(undefined)`, la página se quedaba sin ficha y el
   * usuario veía "no puedo subir imágenes" — sin ningún error en consola ni en los tests, porque
   * el cliente de la API estaba mockeado y el mock devolvía la forma CORRECTA. Se comprueba el
   * comportamiento que el contrato protege: una respuesta incompleta NO debe vaciar la pantalla.
   */
  test('una respuesta sin `vtuber` no deja la pantalla en blanco: avisa en vez de pisar la ficha', async () => {
    // La forma EXACTA que devolvía la ruta de producción antes del arreglo.
    uploadImage.mockResolvedValue({ ok: true, slug: 'gkuro-monochrome', kind: 'character', size: 42 });
    const onUpdated = vi.fn();
    render(<ImageManager token="tok" detail={detailWithAssets()} onUpdated={onUpdated} />);

    fireEvent.change(screen.getByTestId('admin-input-character'), {
      target: { files: [new File(['x'], 'p.png', { type: 'image/png' })] },
    });

    const msg = await screen.findByTestId('toast-error');
    expect(msg.textContent, 'avisa de la respuesta incompleta').toMatch(/no devolvió la ficha/i);
    expect(onUpdated, 'no se propaga un undefined a la ficha seleccionada').not.toHaveBeenCalled();
  });

  test('lo mismo al borrar: sin detalle en la respuesta no se pisa la ficha', async () => {
    deleteImage.mockResolvedValue({ ok: true, slug: 'gkuro-monochrome', kind: 'logo', restaurado: 'catalogo' });
    const onUpdated = vi.fn();
    render(<ImageManager token="tok" detail={detailWithAssets()} onUpdated={onUpdated} />);

    fireEvent.click(screen.getAllByText('Quitar')[0]);
    const msg = await screen.findByTestId('toast-error');
    expect(msg.textContent).toMatch(/no devolvió la ficha/i);
    expect(onUpdated).not.toHaveBeenCalled();
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
