/**
 * Tests del mantenedor: asistente de carta (crear y editar), asistente y gestor de
 * facciones, conversión de emblemas a PNG, banner de primeros pasos, selector de
 * facciones (máx. 2) y editor de listas.
 *
 * El cliente de la API se mockea (no hay red en tests); `ApiError` se conserva real
 * para que los errores del servidor lleguen con su `status`, como en producción.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useState } from 'react';

import { AdminPage } from '@/components/admin-page';
import { CardWizard } from '@/components/admin/card-wizard';
import { checklist, percent } from '@/components/admin/completeness';
import { FactionManager } from '@/components/admin/faction-manager';
import { FactionPicker } from '@/components/admin/faction-picker';
import { FactionWizard } from '@/components/admin/faction-wizard';
import { buildPatch, formFromDetail } from '@/components/admin/form-model';
import { GettingStarted, ONBOARDING_KEY } from '@/components/admin/getting-started';
import { ListEditor } from '@/components/admin/list-editor';
import { aPngCuadrado } from '@/lib/imagen-cliente';
import type { FactionRow, VtuberDetail, VtuberPatch } from '@/lib/types';
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
  setVtuberEmail: vi.fn(),
  dexNext: vi.fn(),
  createFaction: vi.fn(),
  updateFaction: vi.fn(),
  deleteFaction: vi.fn(),
  uploadFactionEmblem: vi.fn(),
  uploadImage: vi.fn(),
  deleteImage: vi.fn(),
}));

vi.mock('@/lib/api', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api')>();
  return { ...actual, api: { ...mocks } };
});

const FACTIONS: FactionRow[] = [
  { id: 1, slug: 'mythical-legacy', label: 'Mythical Legacy', icon: 'images/faction/mythical-legacy.png', total: 40, publicadas: 38 },
  { id: 2, slug: 'moonly', label: 'Moonly', icon: 'images/faction/moonly.png', total: 12, publicadas: 12 },
  { id: 3, slug: 'glovecaller', label: 'Glovecaller', icon: null, total: 3, publicadas: 2 },
];

beforeEach(() => {
  mocks.dexNext.mockResolvedValue({ next: 786 });
  mocks.factions.mockResolvedValue({ items: FACTIONS });
  mocks.session.mockResolvedValue({ user: { username: 'admin', role: 'admin' } });
  mocks.adminStats.mockResolvedValue({
    totals: { total: 785, withDetail: 211, notPublished: 1, sinProblemas: 700 },
    estados: { published: 784, draft: 1, hidden: 0 },
    themes: 205,
    quality: [],
    paises: [{ name: 'Chile', flag: '🇨🇱', count: 120 }],
    facciones: [{ name: 'Netherbane', count: 40 }],
    grados: [{ grade: '10', count: 1 }, { grade: '1', count: 2 }],
    correo: { con: 12, sin: 773 },
    solicitudes: { pendientes: { inscripcion: 2, modificacion: 1, baja: 0 } },
  });
  mocks.audit.mockResolvedValue({ items: [] });
  mocks.list.mockResolvedValue(makeList());
  mocks.adminList.mockResolvedValue({ items: [], total: 0, page: 1, perPage: 40, pageCount: 1 });
});

afterEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

/** Detalle devuelto por un PATCH simulado: aplica solo lo que los tests miran. */
function applyPatch(base: VtuberDetail, patch: VtuberPatch): VtuberDetail {
  return {
    ...base,
    status: patch.status ?? base.status,
    themeColor: patch.themeColor ?? base.themeColor,
    factionIcons: patch.factions ? patch.factions.map((slug) => ({ label: slug, slug, icon: null })) : base.factionIcons,
    factions: patch.factions ?? base.factions,
  };
}

const draft = () => makeDetail({ id: 900, dexNumber: 786, slug: 'nueva', name: 'Nueva', status: 'draft', themeColor: null, factions: [], factionIcons: [], phrase: null, cardText: null, stats: [], socials: [], profile: [], skills: [], images: { ...makeDetail().images, character: null, logo: null } });

type WizardProps = Partial<React.ComponentProps<typeof CardWizard>>;
async function renderWizard(props: WizardProps = {}) {
  const handlers = { notify: vi.fn(), onChanged: vi.fn(), onFactionsChanged: vi.fn(), onExit: vi.fn(), onCreateAnother: vi.fn() };
  const view = render(
    <CardWizard
      token="t"
      mode="edit"
      initial={makeDetail()}
      factions={FACTIONS}
      countryOptions={[{ value: 'chile', label: 'Chile' }]}
      languageOptions={[{ value: 'es', label: 'Español' }]}
      {...handlers}
      {...props}
    />,
  );
  // Espera al número del final: si no, la promesa de `dexNext` resuelve fuera de `act`.
  await screen.findByRole('button', { name: /Mandar al final \(#786\)/ });
  return { ...handlers, ...view };
}

const stepButton = (name: RegExp) => screen.getByRole('button', { name });

describe('FactionPicker', () => {
  test('con dos facciones elegidas la tercera queda deshabilitada', () => {
    function Harness() {
      const [value, setValue] = useState<string[]>([]);
      return <FactionPicker factions={FACTIONS} value={value} onChange={setValue} />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Mythical Legacy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Moonly' }));
    expect(screen.getByRole('button', { name: 'Glovecaller' })).toBeDisabled();
    expect(screen.getByTestId('faction-count')).toHaveTextContent('2 de 2');
    fireEvent.click(screen.getByRole('button', { name: 'Moonly' }));
    expect(screen.getByRole('button', { name: 'Glovecaller' })).toBeEnabled();
  });
});

describe('Asistente de carta: edición', () => {
  test('«Mandar al final» envía dexNumber: "end" en un único PATCH', async () => {
    const { onChanged } = await renderWizard();
    mocks.updateVtuber.mockImplementation(async (_t, _id, patch) => applyPatch(makeDetail(), patch));
    fireEvent.click(screen.getByRole('button', { name: /Mandar al final \(#786\)/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(mocks.updateVtuber).toHaveBeenCalledTimes(1));
    expect(mocks.updateVtuber).toHaveBeenCalledWith('t', 18, { dexNumber: 'end' });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  test('sin cambios el guardado está deshabilitado y lo explica; la dirección está bloqueada y sigue al nombre', async () => {
    await renderWizard();
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
    expect(screen.getByText(/Sin cambios pendientes/)).toBeInTheDocument();
    expect(screen.getByLabelText('Dirección de la página')).toHaveAttribute('readonly');
    fireEvent.change(screen.getByLabelText('Nombre de la carta'), { target: { value: 'Nueva Ñandú' } });
    expect(screen.getByLabelText('Dirección de la página')).toHaveValue('nueva-nandu');
    expect(screen.getByTestId('slug-preview')).toHaveTextContent('/v/nueva-nandu');
    mocks.updateVtuber.mockImplementation(async (_t, _id, patch) => applyPatch(makeDetail(), patch));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(mocks.updateVtuber).toHaveBeenCalledWith('t', 18, { name: 'Nueva Ñandú', slug: 'nueva-nandu' }));
  });

  test('al escribir el correo aparece «Guardar cambio de correo»; guarda solo el correo y avisa de la bienvenida', async () => {
    const { notify } = await renderWizard();
    expect(screen.queryByRole('button', { name: 'Guardar cambio de correo' })).not.toBeInTheDocument();
    mocks.setVtuberEmail.mockResolvedValue({ email: 'ana@ejemplo.com', bienvenida: 'enviada' });
    fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: ' Ana@Ejemplo.com ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambio de correo' }));
    await waitFor(() => expect(mocks.setVtuberEmail).toHaveBeenCalledWith('t', 18, 'Ana@Ejemplo.com'));
    expect(mocks.updateVtuber).not.toHaveBeenCalled();
    await waitFor(() => expect(notify).toHaveBeenCalledWith('ok', expect.stringContaining('bienvenida')));
    expect(screen.getByLabelText('Correo electrónico')).toHaveValue('ana@ejemplo.com');
    expect(screen.queryByRole('button', { name: 'Guardar cambio de correo' })).not.toBeInTheDocument();
  });

  test('un 409 de número ocupado se explica y propone cómo resolverlo', async () => {
    const { ApiError } = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
    await renderWizard();
    mocks.updateVtuber.mockRejectedValue(new ApiError('el #777 ya lo tiene Fulana', 409));
    fireEvent.change(screen.getByLabelText('Número de dex'), { target: { value: '777' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByTestId('admin-editor-error')).toHaveTextContent('el #777 ya lo tiene Fulana');
    expect(screen.getByTestId('admin-dex-hint')).toHaveTextContent(/muévela/i);
  });

  test('una dirección repetida sugiere probar con «-2»', async () => {
    const { ApiError } = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
    const { notify } = await renderWizard();
    mocks.updateVtuber.mockRejectedValue(new ApiError('slug_duplicado', 409));
    fireEvent.change(screen.getByLabelText('Nombre de la carta'), { target: { value: 'gkuro' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByTestId('admin-slug-hint')).toHaveTextContent('gkuro-2');
    expect(notify).toHaveBeenCalledWith('error', expect.stringMatching(/dirección/i));
  });

  test('una red con URL sin http bloquea el guardado y lo explica', async () => {
    await renderWizard();
    fireEvent.click(stepButton(/Atributos, habilidades y redes/));
    fireEvent.click(screen.getByRole('button', { name: '+ Twitch' }));
    fireEvent.change(screen.getByPlaceholderText('https://twitch.tv/tu_canal'), { target: { value: 'javascript:alert(1)' } });
    expect(screen.getByTestId('admin-editor-invalid')).toHaveTextContent(/http/);
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
    expect(mocks.updateVtuber).not.toHaveBeenCalled();
  });

  test('el stepper marca el paso actual y es navegable en cualquier orden', async () => {
    await renderWizard();
    expect(stepButton(/Identidad/)).toHaveAttribute('aria-current', 'step');
    fireEvent.click(stepButton(/Revisar y publicar/));
    expect(stepButton(/Revisar y publicar/)).toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId('checklist')).toBeInTheDocument();
  });

  test('una ficha en borrador ofrece «Continuar asistente», que salta al primer paso pendiente', async () => {
    await renderWizard({ initial: draft() });
    expect(screen.getByTestId('admin-draft-notice')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continuar asistente' }));
    // Lo primero que falta en una carta sin imágenes es el personaje (paso 2).
    expect(stepButton(/Imágenes/)).toHaveAttribute('aria-current', 'step');
  });
});

describe('Asistente de carta: alta', () => {
  test('el paso 1 hace POST y cada «Siguiente» un PATCH solo con lo cambiado; publicar manda status published', async () => {
    const created = draft();
    mocks.createVtuber.mockResolvedValue(created);
    mocks.updateVtuber.mockImplementation(async (_t, _id, patch) => applyPatch(created, patch));
    const { onChanged } = await renderWizard({ mode: 'create', initial: null });

    // Sin nombre no se puede continuar y se dice por qué.
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
    expect(screen.getAllByText('Escribe un nombre para continuar.').length).toBeGreaterThan(0);
    // Los pasos posteriores están bloqueados hasta crear el borrador.
    expect(stepButton(/Imágenes/)).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Nombre de la carta/), { target: { value: 'Nueva Carta' } });
    // La dirección se autogenera y se ve en vivo.
    expect(screen.getByTestId('slug-preview')).toHaveTextContent('/v/nueva-carta');
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await waitFor(() => expect(mocks.createVtuber).toHaveBeenCalledWith('t', { name: 'Nueva Carta', slug: 'nueva-carta' }));
    expect(mocks.updateVtuber).not.toHaveBeenCalled();
    await waitFor(() => expect(stepButton(/Imágenes/)).toHaveAttribute('aria-current', 'step'));
    expect(screen.getByTestId('no-character-warning')).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledWith(created);

    // Paso 2 sin cambios: avanzar no manda nada.
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await waitFor(() => expect(stepButton(/Colores y facciones/)).toHaveAttribute('aria-current', 'step'));
    expect(mocks.updateVtuber).not.toHaveBeenCalled();

    // Paso 3: color y facción -> un PATCH solo con eso.
    fireEvent.click(screen.getByRole('button', { name: 'Color #3b82f6' }));
    fireEvent.click(screen.getByRole('button', { name: 'Moonly' }));
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await waitFor(() => expect(mocks.updateVtuber).toHaveBeenCalledTimes(1));
    expect(mocks.updateVtuber).toHaveBeenLastCalledWith('t', 900, { themeColor: '#3b82f6', factions: ['moonly'] });

    // Paso final: checklist con pendientes y publicación.
    fireEvent.click(stepButton(/Revisar y publicar/));
    expect(within(screen.getByTestId('checklist')).getAllByText('⚠').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByLabelText(/Publicar ahora/));
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar' }));
    await waitFor(() => expect(mocks.updateVtuber).toHaveBeenCalledTimes(2));
    expect(mocks.updateVtuber).toHaveBeenLastCalledWith('t', 900, { status: 'published' });
    expect(await screen.findByTestId('wizard-done')).toHaveTextContent(/lista/);
  });

  test('«Guardar y salir» crea el borrador y cierra sin perder nada', async () => {
    mocks.createVtuber.mockResolvedValue(draft());
    const { onExit } = await renderWizard({ mode: 'create', initial: null });
    fireEvent.change(screen.getByLabelText(/Nombre de la carta/), { target: { value: 'Nueva' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar y salir' }));
    await waitFor(() => expect(onExit).toHaveBeenCalled());
    expect(mocks.createVtuber).toHaveBeenCalledTimes(1);
  });

  test('«¿No está? Crea una facción» abre el asistente de facciones y vuelve con la nueva elegida', async () => {
    mocks.createFaction.mockResolvedValue({ faction: { id: 9, slug: 'nueva-fac', label: 'Nueva Fac', icon: null, total: 0, publicadas: 0 }, items: FACTIONS });
    await renderWizard();
    fireEvent.click(stepButton(/Colores y facciones/));
    fireEvent.click(screen.getByRole('button', { name: '¿No está? Crea una facción' }));
    const dialog = screen.getByRole('dialog', { name: 'Nueva facción' });
    fireEvent.change(within(dialog).getByLabelText('Nombre de la facción'), { target: { value: 'Nueva Fac' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Omitir por ahora' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Crear facción' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Volver a la ficha' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('faction-count')).toHaveTextContent('2 de 2');
  });
});

describe('completitud', () => {
  test('el porcentaje cuenta solo los ítems núcleo y el checklist indica el paso de cada faltante', () => {
    const items = checklist({
      name: 'A', slug: 'a', character: true, logo: false, themeColor: true, factions: 0,
      phrase: true, cardText: false, stats: 3, socials: 0, profile: 0, skills: 0,
    });
    expect(percent(items)).toBe(56); // 5 de 9 núcleo (nombre, personaje, color, frase, atributos)
    expect(items.find((item) => item.id === 'logo')?.step).toBe('imagenes');
    expect(items.find((item) => item.id === 'perfil')?.optional).toBe(true);
  });
});

describe('Facciones: asistente', () => {
  test('valida el nombre duplicado en vivo y no deja continuar', () => {
    render(<FactionWizard token="t" factions={FACTIONS} onItems={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Nombre de la facción'), { target: { value: 'moonly' } });
    expect(screen.getByTestId('faction-name-problem')).toHaveTextContent(/Ya existe «Moonly»/);
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Nombre de la facción'), { target: { value: 'Otra' } });
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeEnabled();
  });

  test('crea la facción y DESPUÉS sube el emblema como PNG', async () => {
    const onItems = vi.fn();
    const created: FactionRow = { id: 9, slug: 'otra', label: 'Otra', icon: null, total: 0, publicadas: 0 };
    mocks.createFaction.mockResolvedValue({ faction: created, items: [...FACTIONS, created] });
    mocks.uploadFactionEmblem.mockResolvedValue({ faction: { ...created, icon: 'images/faction/otra.png?v=1' }, items: [...FACTIONS, created], asset: {} });
    render(<FactionWizard token="t" factions={FACTIONS} onItems={onItems} onClose={vi.fn()} onAssign={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Nombre de la facción'), { target: { value: 'Otra' } });
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    const file = new File(['png'], 'emblema.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('emblem-input'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(screen.getByRole('button', { name: 'Crear facción' }));
    expect(await screen.findByTestId('faction-wizard-done')).toHaveTextContent('Otra');
    expect(mocks.createFaction).toHaveBeenCalledWith('t', { label: 'Otra' });
    expect(mocks.uploadFactionEmblem).toHaveBeenCalledTimes(1);
    expect(mocks.uploadFactionEmblem.mock.calls[0][1]).toBe(9);
    expect(mocks.uploadFactionEmblem.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.createFaction.mock.invocationCallOrder[0]);
    expect(screen.getByRole('button', { name: 'Crear otra' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Asignarla a una ficha' })).toBeInTheDocument();
  });

  test('se puede omitir el emblema (con aviso) y no se sube nada', async () => {
    const created: FactionRow = { id: 9, slug: 'otra', label: 'Otra', icon: null, total: 0, publicadas: 0 };
    mocks.createFaction.mockResolvedValue({ faction: created, items: [...FACTIONS, created] });
    render(<FactionWizard token="t" factions={FACTIONS} onItems={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Nombre de la facción'), { target: { value: 'Otra' } });
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Omitir por ahora' }));
    expect(screen.getByRole('status')).toHaveTextContent(/Sin emblema/);
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(screen.getByRole('button', { name: 'Crear facción' }));
    expect(await screen.findByTestId('faction-wizard-done')).toBeInTheDocument();
    expect(mocks.uploadFactionEmblem).not.toHaveBeenCalled();
  });

  test('si el emblema falla tras crear, no se duplica la facción y se avisa', async () => {
    const created: FactionRow = { id: 9, slug: 'otra', label: 'Otra', icon: null, total: 0, publicadas: 0 };
    mocks.createFaction.mockResolvedValue({ faction: created, items: [...FACTIONS, created] });
    mocks.uploadFactionEmblem.mockRejectedValue(new Error('formato_invalido'));
    render(<FactionWizard token="t" factions={FACTIONS} onItems={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Nombre de la facción'), { target: { value: 'Otra' } });
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    fireEvent.change(screen.getByTestId('emblem-input'), { target: { files: [new File(['x'], 'e.png', { type: 'image/png' })] } });
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(screen.getByRole('button', { name: 'Crear facción' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/formato_invalido/);
    expect(mocks.createFaction).toHaveBeenCalledTimes(1);
  });
});

describe('Facciones: mantenedor', () => {
  test('fusionar pide confirmación mostrando cuántas fichas afecta y recién entonces llama a la API', async () => {
    const onItems = vi.fn();
    const onStructureChanged = vi.fn();
    mocks.deleteFaction.mockResolvedValue({ ok: true, items: FACTIONS.slice(0, 2) });
    render(<FactionManager token="t" factions={FACTIONS} onItems={onItems} onStructureChanged={onStructureChanged} />);
    const row = screen.getAllByTestId('faction-row')[2];
    fireEvent.click(within(row).getByRole('button', { name: 'Fusionar con otra' }));
    fireEvent.change(within(row).getByLabelText('Facción de destino'), { target: { value: '2' } });
    expect(within(row).getByRole('alertdialog')).toHaveTextContent(/3 fichas pasarán de «Glovecaller» a «Moonly»/);
    expect(mocks.deleteFaction).not.toHaveBeenCalled();
    fireEvent.click(within(row).getByRole('button', { name: 'Confirmar fusión' }));
    await waitFor(() => expect(mocks.deleteFaction).toHaveBeenCalledWith('t', 3, 2));
    await waitFor(() => expect(onItems).toHaveBeenCalledWith(FACTIONS.slice(0, 2)));
    expect(onStructureChanged).toHaveBeenCalled();
  });

  test('eliminar avisa que las fichas pierden la facción y se puede cancelar', () => {
    render(<FactionManager token="t" factions={FACTIONS} onItems={vi.fn()} />);
    const row = screen.getAllByTestId('faction-row')[0];
    fireEvent.click(within(row).getByRole('button', { name: 'Eliminar' }));
    expect(within(row).getByRole('alertdialog')).toHaveTextContent(/40 fichas perderán/);
    fireEvent.click(within(row).getByRole('button', { name: 'Cancelar' }));
    expect(mocks.deleteFaction).not.toHaveBeenCalled();
  });

  test('las facciones sin emblema se marcan y ofrecen subirlo directamente', () => {
    render(<FactionManager token="t" factions={FACTIONS} onItems={vi.fn()} />);
    expect(screen.getByTestId('faction-warnings')).toHaveTextContent('Glovecaller no tiene emblema aún');
    const row = screen.getAllByTestId('faction-row')[2];
    expect(within(row).getByRole('button', { name: 'Subir emblema' })).toBeInTheDocument();
    expect(within(screen.getAllByTestId('faction-row')[0]).getByRole('button', { name: 'Cambiar emblema' })).toBeInTheDocument();
  });

  test('cambiar el emblema por arrastrar y soltar sube el archivo a esa facción', async () => {
    mocks.uploadFactionEmblem.mockResolvedValue({ faction: FACTIONS[0], items: FACTIONS, asset: {} });
    const onItems = vi.fn();
    render(<FactionManager token="t" factions={FACTIONS} onItems={onItems} />);
    const row = screen.getAllByTestId('faction-row')[0];
    const file = new File(['png'], 'e.png', { type: 'image/png' });
    fireEvent.drop(within(row).getByText('Arrastra un archivo para cambiar el emblema'), { dataTransfer: { files: [file] } });
    await waitFor(() => expect(mocks.uploadFactionEmblem).toHaveBeenCalledTimes(1));
    expect(mocks.uploadFactionEmblem.mock.calls[0][1]).toBe(1);
  });

  test('renombrar valida duplicados y guarda con la API', async () => {
    mocks.updateFaction.mockResolvedValue({ faction: FACTIONS[1], items: FACTIONS });
    render(<FactionManager token="t" factions={FACTIONS} onItems={vi.fn()} />);
    const row = screen.getAllByTestId('faction-row')[1];
    fireEvent.click(within(row).getByRole('button', { name: 'Renombrar' }));
    const input = within(row).getByLabelText('Nuevo nombre de Moonly');
    fireEvent.change(input, { target: { value: 'glovecaller' } });
    expect(within(row).getByRole('button', { name: 'Guardar nombre' })).toBeDisabled();
    fireEvent.change(input, { target: { value: 'Moonly Plus' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Guardar nombre' }));
    await waitFor(() => expect(mocks.updateFaction).toHaveBeenCalledWith('t', 2, { label: 'Moonly Plus' }));
  });
});

describe('aPngCuadrado', () => {
  const realGetContext = HTMLCanvasElement.prototype.getContext;
  const realToBlob = HTMLCanvasElement.prototype.toBlob;
  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = realGetContext;
    HTMLCanvasElement.prototype.toBlob = realToBlob;
    delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
  });

  function mockCanvas(blobSize: number) {
    const drawImage = vi.fn();
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage })) as unknown as typeof realGetContext;
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
      cb(new Blob([new Uint8Array(blobSize)], { type: 'image/png' }));
    } as typeof realToBlob;
    return drawImage;
  }

  test('reduce a ≤512 px, centra en un lienzo cuadrado y exporta PNG', async () => {
    const drawImage = mockCanvas(1000);
    (globalThis as { createImageBitmap?: unknown }).createImageBitmap = vi.fn().mockResolvedValue({ width: 2000, height: 1000, close: vi.fn() });
    const out = await aPngCuadrado(new File(['x'], 'big.jpg', { type: 'image/jpeg' }));
    expect(out.type).toBe('image/png');
    // 2000x1000 -> 512x256 centrado verticalmente en un lienzo de 512x512.
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 128, 512, 256);
  });

  test('no agranda lo pequeño', async () => {
    const drawImage = mockCanvas(1000);
    (globalThis as { createImageBitmap?: unknown }).createImageBitmap = vi.fn().mockResolvedValue({ width: 100, height: 100, close: vi.fn() });
    await aPngCuadrado(new File(['x'], 's.png', { type: 'image/png' }));
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 100, 100);
  });

  test('rechaza con un mensaje claro lo que sigue pesando más de 2 MB', async () => {
    mockCanvas(3 * 1024 * 1024);
    (globalThis as { createImageBitmap?: unknown }).createImageBitmap = vi.fn().mockResolvedValue({ width: 512, height: 512, close: vi.fn() });
    await expect(aPngCuadrado(new File(['x'], 'p.png', { type: 'image/png' }))).rejects.toThrow(/2 MB/);
  });

  test('sin soporte del navegador devuelve el original y decide el servidor', async () => {
    const file = new File(['x'], 'o.png', { type: 'image/png' });
    expect(await aPngCuadrado(file)).toBe(file);
  });
});

describe('GettingStarted', () => {
  test('se muestra la primera vez y el descarte se recuerda', async () => {
    const { unmount } = render(<GettingStarted onGoFactions={vi.fn()} onNewCard={vi.fn()} />);
    expect(await screen.findByTestId('getting-started')).toHaveTextContent(/Primeros pasos/);
    fireEvent.click(screen.getByRole('button', { name: 'Entendido, ocultar' }));
    expect(screen.queryByTestId('getting-started')).toBeNull();
    expect(window.localStorage.getItem(ONBOARDING_KEY)).toBe('1');
    unmount();
    render(<GettingStarted onGoFactions={vi.fn()} onNewCard={vi.fn()} />);
    await act(async () => {});
    expect(screen.queryByTestId('getting-started')).toBeNull();
  });

  test('si localStorage lanza, el banner igual se muestra y se puede descartar', async () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    render(<GettingStarted onGoFactions={vi.fn()} onNewCard={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Entendido, ocultar' }));
    expect(screen.queryByTestId('getting-started')).toBeNull();
    spy.mockRestore();
    set.mockRestore();
  });
});

describe('buildPatch', () => {
  test('una ficha sin tocar no genera parche, aunque traiga datos heredados inválidos', () => {
    const detail = makeDetail({ socials: [{ platform: 'x', label: null, url: 'ftp://raro', icon: null }] });
    expect(buildPatch(detail, formFromDetail(detail))).toEqual({ patch: {}, errors: [] });
  });

  test('las facciones salen como slugs y las habilidades conservan sus emblemas y su HTML con colores', () => {
    const html = 'Aplicas <span style="color:#074fcc; font-weight:bold;">Miedo</span>.<br>';
    const detail = makeDetail({
      skills: [
        { category: 'active', section: null, type: null, name: 'Golpe', effect: 'x', effectHtml: null, factions: [{ src: 'a.png', name: 'A' }], position: 0 },
        { category: 'passive', section: null, type: null, name: 'Calma', effect: 'Aplicas Miedo.', effectHtml: html, factions: [], position: 1 },
      ],
    });
    const form = formFromDetail(detail);
    expect(form.factions).toEqual(['mythical-legacy']);
    form.skills[0].name = 'Golpe fuerte';
    const { patch } = buildPatch(detail, form);
    // Tocar UNA habilidad reenvía el kit entero: la que no se tocó tiene que volver con su HTML,
    // o el servidor la guardaría sin colores (lo que pasaba antes de `effectHtml` en el formulario).
    expect(patch.skills).toEqual([
      { category: 'active', section: null, type: null, name: 'Golpe fuerte', effect: 'x', effectHtml: null, factions: [{ src: 'a.png', name: 'A' }] },
      { category: 'passive', section: null, type: null, name: 'Calma', effect: 'Aplicas Miedo.', effectHtml: html, factions: [] },
    ]);
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
    expect(screen.getByRole('button', { name: 'Subir elemento 1' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Bajar elemento 2' })).toBeDisabled();
  });
});

describe('AdminPage', () => {
  test('tiene las secciones «Fichas» y «Emblemas y facciones» y cambia entre ellas', async () => {
    window.localStorage.setItem('vtuberdex.admin.token', 'tok');
    render(<AdminPage />);
    const emblemas = await screen.findByRole('tab', { name: 'Emblemas y facciones' });
    expect(screen.getByRole('tab', { name: 'Fichas' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(emblemas);
    expect(emblemas).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findAllByTestId('faction-row')).toHaveLength(3);
  });

  test('«Nueva carta» abre el asistente en el paso Identidad', async () => {
    window.localStorage.setItem('vtuberdex.admin.token', 'tok');
    render(<AdminPage />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Nueva carta' }))[0]);
    expect(await screen.findByTestId('admin-editor')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Paso 1 de 6: Identidad/ })).toBeInTheDocument();
  });

  test('abre una ficha por id con la ruta del mantenedor, con insignia de completitud', async () => {
    window.localStorage.setItem('vtuberdex.admin.token', 'tok');
    const detail = makeDetail({ id: 18 });
    mocks.adminList.mockResolvedValue({ items: [detail], total: 1, page: 1, perPage: 40, pageCount: 1 });
    mocks.adminDetail.mockResolvedValue(detail);
    render(<AdminPage />);
    // Sin búsqueda ni filtro la lista no pide nada: es un buscador, no un índice.
    expect(await screen.findByTestId('list-idle')).toBeInTheDocument();
    expect(mocks.adminList).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText('nombre o número'), { target: { value: 'gkuro' } });
    const row = await screen.findByRole('button', { name: /GKuro Monochrome/ });
    expect(mocks.adminList).toHaveBeenLastCalledWith('tok', expect.objectContaining({ q: 'gkuro', perPage: 10 }), expect.anything());
    expect(within(row).getByTestId('row-percent')).toHaveTextContent(/%/);
    fireEvent.click(row);
    await waitFor(() => expect(mocks.adminDetail).toHaveBeenCalledWith('tok', 18));
    expect(await screen.findByTestId('admin-editor')).toBeInTheDocument();
  });

  test('el panel muestra medidores y gráficos del catálogo', async () => {
    window.localStorage.setItem('vtuberdex.admin.token', 'tok');
    render(<AdminPage />);
    const panel = await screen.findByTestId('panel-estadisticas');
    expect(within(panel).getAllByTestId('medidor')).toHaveLength(4);
    expect(within(panel).getByRole('img', { name: /Publicadas: 100%/ })).toBeInTheDocument();
    expect(within(panel).getByRole('img', { name: /Con correo: 2%/ })).toBeInTheDocument();
    expect(within(panel).getByText('Top 10 países')).toBeInTheDocument();
    expect(within(panel).getByTitle('🇨🇱 Chile: 120')).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: 'revisar' }));
    expect(screen.getByRole('tab', { name: 'Solicitudes' })).toHaveAttribute('aria-selected', 'true');
  });
});
