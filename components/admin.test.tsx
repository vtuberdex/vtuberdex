/**
 * Tests del mantenedor: selector de facciones (máx. 2), número de dex, alta de
 * cartas, gestor de facciones (confirmación) y editor de listas.
 *
 * El cliente de la API se mockea (no hay red en tests); `ApiError` se conserva real
 * para que los errores del servidor lleguen con su `status`, como en producción.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useState } from 'react';

import { AdminPage } from '@/components/admin-page';
import { EditorCard } from '@/components/admin/editor-card';
import { FactionManager } from '@/components/admin/faction-manager';
import { FactionPicker } from '@/components/admin/faction-picker';
import { buildPatch, formFromDetail } from '@/components/admin/form-model';
import { ListEditor } from '@/components/admin/list-editor';
import type { FactionRow } from '@/lib/types';
import { makeDetail, makeList } from '@/test/fixtures';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  adminStats: vi.fn(),
  audit: vi.fn(),
  factions: vi.fn(),
  list: vi.fn(),
  adminList: vi.fn(),
  adminDetail: vi.fn(),
  createVtuber: vi.fn(),
  updateVtuber: vi.fn(),
  dexNext: vi.fn(),
  createFaction: vi.fn(),
  updateFaction: vi.fn(),
  deleteFaction: vi.fn(),
}));

vi.mock('@/lib/api', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api')>();
  return { ...actual, api: { ...mocks } };
});

const FACTIONS: FactionRow[] = [
  { id: 1, slug: 'mythical-legacy', label: 'Mythical Legacy', icon: 'images/faction/mythical-legacy.png', total: 40, publicadas: 38 },
  { id: 2, slug: 'moonly', label: 'Moonly', icon: null, total: 12, publicadas: 12 },
  { id: 3, slug: 'moonly-dup', label: 'Moonlyy', icon: null, total: 3, publicadas: 2 },
];

beforeEach(() => {
  mocks.dexNext.mockResolvedValue({ next: 786 });
  mocks.factions.mockResolvedValue({ items: FACTIONS });
  mocks.session.mockResolvedValue({ user: { username: 'admin', role: 'admin' } });
  mocks.adminStats.mockResolvedValue({ totals: { total: 785, withDetail: 211, notPublished: 1 }, themes: 205, quality: [] });
  mocks.audit.mockResolvedValue({ items: [] });
  mocks.list.mockResolvedValue(makeList());
  mocks.adminList.mockResolvedValue({ items: [], total: 0, page: 1, perPage: 40, pageCount: 1 });
});

afterEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

async function renderEditor(overrides: Partial<React.ComponentProps<typeof EditorCard>> = {}) {
  const onSave = vi.fn();
  const view = render(
    <EditorCard
      token="t"
      detail={makeDetail()}
      factions={FACTIONS}
      countryOptions={[{ value: 'chile', label: 'Chile' }]}
      languageOptions={[{ value: 'es', label: 'Español' }]}
      saving={false}
      savedAt={null}
      error={null}
      onSave={onSave}
      {...overrides}
    />,
  );
  // Espera al número del final: si no, la promesa de `dexNext` resuelve fuera de `act`.
  await screen.findByRole('button', { name: /Mandar al final \(#786\)/ });
  return { onSave, ...view };
}

describe('FactionPicker', () => {
  test('con dos facciones elegidas la tercera queda deshabilitada', () => {
    function Harness() {
      const [value, setValue] = useState<string[]>([]);
      return <FactionPicker factions={FACTIONS} value={value} onChange={setValue} />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Mythical Legacy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Moonly' }));
    expect(screen.getByRole('button', { name: 'Moonlyy' })).toBeDisabled();
    expect(screen.getByTestId('faction-count')).toHaveTextContent('2 de 2');
    // Quitar una libera el cupo.
    fireEvent.click(screen.getByRole('button', { name: 'Moonly' }));
    expect(screen.getByRole('button', { name: 'Moonlyy' })).toBeEnabled();
  });
});

describe('EditorCard: número de dex y guardado', () => {
  test('«Mandar al final» envía dexNumber: "end" en un único PATCH', async () => {
    const { onSave } = await renderEditor();
    const button = await screen.findByRole('button', { name: /Mandar al final \(#786\)/ });
    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({ dexNumber: 'end' });
  });

  test('solo se envía lo modificado y sin cambios el guardado está deshabilitado', async () => {
    const { onSave } = await renderEditor();
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('URL de la página'), { target: { value: 'Nueva Ñandú' } });
    expect(screen.getByTestId('slug-preview')).toHaveTextContent('/v/nueva-nandu');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(onSave).toHaveBeenCalledWith({ slug: 'nueva-nandu' });
  });

  test('un 409 de dex ocupado se muestra con la explicación de cómo resolverlo', async () => {
    const detail = makeDetail();
    // El formulario parte de `detail`; el número se cambia antes de que llegue el error del servidor.
    const { rerender, onSave } = await renderEditor({ detail });
    fireEvent.change(screen.getByLabelText('Número de dex'), { target: { value: '777' } });
    rerender(
      <EditorCard
        token="t"
        detail={detail}
        factions={FACTIONS}
        countryOptions={[]}
        languageOptions={[]}
        saving={false}
        savedAt={null}
        error={{ message: 'el #777 ya lo tiene Fulana', status: 409 }}
        onSave={onSave}
      />,
    );
    expect(screen.getByTestId('admin-editor-error')).toHaveTextContent('el #777 ya lo tiene Fulana');
    expect(screen.getByTestId('admin-dex-hint')).toHaveTextContent(/mueve|muévela/i);
  });

  test('una red con URL sin http bloquea el guardado y lo explica', async () => {
    const { onSave } = await renderEditor();
    fireEvent.click(screen.getByRole('tab', { name: /Redes/ }));
    fireEvent.click(screen.getByRole('button', { name: /Agregar red social/ }));
    const inputs = screen.getAllByRole('textbox');
    fireEvent.change(inputs[0], { target: { value: 'twitch' } });
    fireEvent.change(inputs[2], { target: { value: 'javascript:alert(1)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId('admin-editor-invalid')).toHaveTextContent(/http/);
  });
});

describe('buildPatch', () => {
  test('una ficha sin tocar no genera parche, aunque traiga datos heredados inválidos', () => {
    const detail = makeDetail({ socials: [{ platform: 'x', label: null, url: 'ftp://raro', icon: null }] });
    expect(buildPatch(detail, formFromDetail(detail))).toEqual({ patch: {}, errors: [] });
  });

  test('las facciones salen como slugs y las habilidades conservan sus emblemas', () => {
    const detail = makeDetail({
      skills: [{ category: 'active', section: null, type: null, name: 'Golpe', effect: 'x', effectHtml: null, factions: [{ src: 'a.png', name: 'A' }], position: 0 }],
    });
    const form = formFromDetail(detail);
    expect(form.factions).toEqual(['mythical-legacy']);
    form.skills[0].name = 'Golpe fuerte';
    const { patch } = buildPatch(detail, form);
    expect(patch.skills).toEqual([
      { category: 'active', section: null, type: null, name: 'Golpe fuerte', effect: 'x', factions: [{ src: 'a.png', name: 'A' }] },
    ]);
  });
});

describe('FactionManager', () => {
  test('fusionar pide confirmación mostrando cuántas fichas afecta y recién entonces llama a la API', async () => {
    const onItems = vi.fn();
    mocks.deleteFaction.mockResolvedValue({ ok: true, items: FACTIONS.slice(0, 2) });
    render(<FactionManager token="t" factions={FACTIONS} onItems={onItems} />);
    const row = screen.getAllByTestId('faction-row')[2];
    fireEvent.click(within(row).getByRole('button', { name: 'Fusionar' }));
    fireEvent.change(within(row).getByLabelText('Facción de destino'), { target: { value: '2' } });
    expect(within(row).getByRole('alertdialog')).toHaveTextContent(/3 fichas pasarán de «Moonlyy» a «Moonly»/);
    expect(mocks.deleteFaction).not.toHaveBeenCalled();
    fireEvent.click(within(row).getByRole('button', { name: 'Confirmar fusión' }));
    await waitFor(() => expect(mocks.deleteFaction).toHaveBeenCalledWith('t', 3, 2));
    await waitFor(() => expect(onItems).toHaveBeenCalledWith(FACTIONS.slice(0, 2)));
  });

  test('eliminar avisa que las fichas pierden la facción y se puede cancelar', () => {
    render(<FactionManager token="t" factions={FACTIONS} onItems={vi.fn()} />);
    const row = screen.getAllByTestId('faction-row')[0];
    fireEvent.click(within(row).getByRole('button', { name: 'Eliminar' }));
    expect(within(row).getByRole('alertdialog')).toHaveTextContent(/40 fichas perderán/);
    fireEvent.click(within(row).getByRole('button', { name: 'Cancelar' }));
    expect(mocks.deleteFaction).not.toHaveBeenCalled();
    expect(within(row).queryByRole('alertdialog')).toBeNull();
  });
});

describe('ListEditor', () => {
  function Harness({ initial }: { initial: string[] }) {
    const [items, setItems] = useState(initial);
    return (
      <ListEditor
        noun="elemento"
        items={items}
        onChange={setItems}
        newItem={() => ''}
        addLabel="Agregar elemento"
        emptyText="vacío"
        renderItem={(item, update, index) => (
          <input aria-label={`valor ${index + 1}`} value={item} onChange={(event) => update(event.target.value as never)} />
        )}
      />
    );
  }
  const values = () => screen.queryAllByRole('textbox').map((input) => (input as HTMLInputElement).value);

  test('agrega, reordena y quita', () => {
    render(<Harness initial={['a', 'b']} />);
    fireEvent.click(screen.getByRole('button', { name: /Agregar elemento/ }));
    expect(values()).toEqual(['a', 'b', '']);
    fireEvent.click(screen.getByRole('button', { name: 'Bajar elemento 1' }));
    expect(values()).toEqual(['b', 'a', '']);
    fireEvent.click(screen.getByRole('button', { name: 'Subir elemento 3' }));
    expect(values()).toEqual(['b', '', 'a']);
    fireEvent.click(screen.getByRole('button', { name: 'Quitar elemento 2' }));
    expect(values()).toEqual(['b', 'a']);
    // Los extremos no se pueden mover más allá.
    expect(screen.getByRole('button', { name: 'Subir elemento 1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Bajar elemento 2' })).toBeDisabled();
  });
});

describe('AdminPage', () => {
  test('crear una carta llama al POST y abre el editor en borrador', async () => {
    window.localStorage.setItem('vtuberdex.admin.token', 'tok');
    const draft = makeDetail({ id: 900, dexNumber: 786, slug: 'nueva', name: 'Nueva', status: 'draft' });
    mocks.createVtuber.mockResolvedValue(draft);
    render(<AdminPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Nueva carta' }));
    fireEvent.change(screen.getByLabelText(/Nombre \(obligatorio\)/), { target: { value: 'Nueva' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear carta' }));
    await waitFor(() => expect(mocks.createVtuber).toHaveBeenCalledWith('tok', { name: 'Nueva' }));
    expect(await screen.findByTestId('admin-editor')).toBeInTheDocument();
    expect(screen.getByTestId('admin-created')).toHaveTextContent(/BORRADOR/);
    expect(screen.getByTestId('admin-draft-notice')).toBeInTheDocument();
  });

  test('abre el editor por id con la ruta del mantenedor y muestra el error 409 al guardar', async () => {
    window.localStorage.setItem('vtuberdex.admin.token', 'tok');
    const { ApiError } = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
    const detail = makeDetail({ id: 18 });
    mocks.adminList.mockResolvedValue({ items: [detail], total: 1, page: 1, perPage: 40, pageCount: 1 });
    mocks.adminDetail.mockResolvedValue(detail);
    mocks.updateVtuber.mockRejectedValue(new ApiError('el #777 ya lo tiene Fulana', 409));
    render(<AdminPage />);
    fireEvent.click(await screen.findByRole('button', { name: /GKuro Monochrome/ }));
    await waitFor(() => expect(mocks.adminDetail).toHaveBeenCalledWith('tok', 18));
    fireEvent.change(await screen.findByLabelText('Número de dex'), { target: { value: '777' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(mocks.updateVtuber).toHaveBeenCalledWith('tok', 18, { dexNumber: 777 }));
    expect(await screen.findByTestId('admin-editor-error')).toHaveTextContent('el #777 ya lo tiene Fulana');
    expect(screen.getByTestId('admin-error')).toBeInTheDocument();
    expect(screen.getByTestId('admin-dex-hint')).toBeInTheDocument();
  });
});
