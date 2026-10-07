import {
  aTokens,
  estadosDisponibles,
  habilidadesDelKit,
  htmlDeActiva,
  htmlDeUltimate,
  kitDesdeHabilidades,
  kitVacio,
  reemplazarKit,
  revisarKit,
  type KitForm,
} from '@/components/admin/kit-habilidades';
import { emptySkill } from '@/components/admin/form-model';
import { htmlDeHabilidadSeguro } from '@/server/src/habilidades.mjs';

/** Un kit completo y correcto; cada prueba lo cambia en un punto. */
function kitCompleto(): KitForm {
  const kit = kitVacio();
  kit.activas[0] = { ...kit.activas[0], nombre: 'Abyssal Bite', ataque: 'base', bono: '45', estado: { nombre: 'Sangrado', verbo: 'aplicas' } };
  kit.activas[1] = {
    ...kit.activas[1],
    nombre: 'Tidal Hymn',
    ataque: 'magico',
    bono: '40',
    estado: { nombre: 'Fortissimo', verbo: 'aplicas' },
    extra: 'Si el enemigo posee [[Sangrado]], recuperas 5% de MP.',
  };
  kit.pasivas[0] = { nombre: 'Deep Pressure', texto: 'Al iniciar tu turno con menos del 50% de HP, recuperas 10 MP.' };
  kit.pasivas[1] = { nombre: 'Black Tide', texto: 'La primera vez que recibes un golpe crítico, obtienes [[Clarividencia]] durante 2 turnos.' };
  kit.ultimate = {
    ...kit.ultimate,
    nombre: 'Leviathan Requiem',
    estados: [
      { nombre: 'Miedo', verbo: 'aplicas' },
      { nombre: 'Revitalia', verbo: 'aplicas' },
    ],
  };
  return kit;
}

describe('kit de habilidades: armado', () => {
  it('un kit completo sale sin faltantes ni problemas, y su HTML pasa la lista blanca del servidor', () => {
    const { habilidades, faltan, problemas } = revisarKit(kitCompleto(), ['abyssal']);
    expect(faltan).toEqual([]);
    expect(problemas).toEqual([]);
    expect(habilidades.map((h) => h.category)).toEqual(['active', 'active', 'passive', 'passive', 'ultimate']);
    for (const h of habilidades) expect(htmlDeHabilidadSeguro(h.effectHtml)).toBe(true);
  });

  it('la activa pone el verbo por la polaridad, no por lo que se elija', () => {
    const kit = kitCompleto();
    expect(htmlDeActiva(kit.activas[0])).toBe(
      'Ataque Base +45 y aplicas <span style="color:#b00101; font-weight:bold;">Sangrado</span> durante 2 turnos.<br>',
    );
    // Fortissimo es positivo: aunque el formulario diga «aplicas», se obtiene.
    expect(htmlDeActiva(kit.activas[1])).toMatch(/^Ataque Mágico Base \+40 y obtienes <span[^>]*>Fortissimo<\/span>/);
  });

  it('un estado ambivalente respeta el verbo elegido', () => {
    const kit = kitCompleto();
    kit.activas[0].estado = { nombre: 'Hackeo', verbo: 'obtienes' };
    expect(htmlDeActiva(kit.activas[0])).toContain('y obtienes <span');
  });

  it('la Ultimate escribe la EVOLUCIÓN de cada estado con sus efectos oficiales', () => {
    const html = htmlDeUltimate(kitCompleto().ultimate);
    expect(html).toContain('Realizas 4 ataques consecutivos equivalentes a Ataque Base +40.<br>');
    expect(html).toMatch(/Aplicas <span[^>]*>Terror Primordial<\/span> y obtienes <span[^>]*>Renacimiento<\/span> durante 2 turnos/);
    expect(html).toContain('Mientras <span style="color:#074fcc; font-weight:bold;">Terror Primordial</span> esté activo:<br>');
    expect(html).toContain('Elimina un estado negativo al activarse.<br>');
    expect(html).not.toMatch(/>Miedo</);
  });

  it('las tres fórmulas de la Ultimate', () => {
    const u = kitCompleto().ultimate;
    expect(htmlDeUltimate({ ...u, formula: 'dado', ataque: 'magico', bono: '35' })).toMatch(
      /^Lanza 1d6, donde X es el resultado obtenido\.<br>\nRealizas X ataques consecutivos equivalentes a Ataque Mágico Base \+35\.<br>/,
    );
    expect(htmlDeUltimate({ ...u, formula: 'directo', bono: '120' })).toMatch(/^Ataque Base \+120\.<br>/);
  });

  it('la Habilidad Única va después de los estados, con su condición y su color', () => {
    const kit = kitCompleto();
    kit.ultimate.unica = {
      activa: true,
      nombre: 'Drowned Crown',
      color: '#1a7f9c',
      condicion: 'Si el enemigo posee 2 o más estados negativos',
      turnos: '2',
      efectos: 'Tus habilidades ofensivas infligen +30 daño adicional.\nSi el enemigo posee [[Terror Primordial]], recuperas 5% de HP.',
    };
    const html = htmlDeUltimate(kit.ultimate);
    expect(html.indexOf('Drowned Crown')).toBeGreaterThan(html.lastIndexOf('Renacimiento'));
    expect(html).toContain('Si el enemigo posee 2 o más estados negativos, se activa la habilidad única <span style="color:#1a7f9c; font-weight:bold;">Drowned Crown</span> durante 2 turnos.<br>');
    expect(html).toContain('<span style="color:#074fcc; font-weight:bold;">Terror Primordial</span>, recuperas 5% de HP.<br>');
    expect(revisarKit(kit, ['abyssal']).problemas).toEqual([]);
  });

  it('lo escrito a mano se escapa: no se puede colar HTML', () => {
    const kit = kitCompleto();
    kit.pasivas[0].texto = '<img src=x onerror=alert(1)> +10 daño';
    const [, , pasiva] = habilidadesDelKit(kit);
    expect(pasiva.effectHtml).toBe('&lt;img src=x onerror=alert(1)&gt; +10 daño<br>');
    expect(htmlDeHabilidadSeguro(pasiva.effectHtml)).toBe(true);
    expect(pasiva.effect).toBe('<img src=x onerror=alert(1)> +10 daño');
  });

  it('avisa lo que falta y los dos estados iguales en la Ultimate', () => {
    const kit = kitCompleto();
    kit.pasivas[1].nombre = '';
    kit.ultimate.estados = [
      { nombre: 'Miedo', verbo: 'aplicas' },
      { nombre: 'Miedo', verbo: 'aplicas' },
    ];
    expect(revisarKit(kit, []).faltan).toEqual(['Nombre de la Pasiva 2', 'Dos estados DISTINTOS en la Ultimate']);
  });

  it('las reglas del sistema siguen aplicando: un estado repetido sale como aviso', () => {
    const kit = kitCompleto();
    kit.activas[0].estado = { nombre: 'Miedo', verbo: 'aplicas' };
    const repetido = revisarKit(kit, []).problemas.find((p) => p.codigo === 'estado_repetido');
    expect(repetido?.pieza).toBe('Activa 1, Ultimate');
  });

  it('los estados exclusivos se bloquean si la ficha no tiene la facción', () => {
    const juramento = (f: string[]) => estadosDisponibles(f).find((e) => e.nombre === 'Juramento')!.bloqueado;
    expect(juramento(['abyssal'])).toBe(true);
    expect(juramento(['heaven-s-arbiter'])).toBe(false);
  });
});

describe('kit de habilidades: desde lo que ya existe', () => {
  it('aTokens devuelve los estados como [[tokens]] y los <br> como saltos', () => {
    expect(aTokens('Obtienes <span style="color:#b10260; font-weight:bold;">Mente Ágil</span> 1 turno.<br>\nRecuperas 5 MP.<br>')).toBe(
      'Obtienes [[Mente Agil]] 1 turno.\nRecuperas 5 MP.',
    );
  });

  it('precarga nombres y pasivas, y al reemplazar conserva las habilidades «otras»', () => {
    const otra = { ...emptySkill(), category: 'other' as const, name: 'Extra' };
    const actuales = [
      { ...emptySkill(), name: 'Vieja A', type: 'Defensivo' },
      { ...emptySkill(), category: 'passive' as const, name: 'Pasiva vieja', effect: 'Recupera 5 MP.' },
      otra,
    ];
    const kit = kitDesdeHabilidades(actuales);
    expect(kit.activas[0]).toMatchObject({ nombre: 'Vieja A', tipo: 'Defensivo' });
    expect(kit.pasivas[0]).toEqual({ nombre: 'Pasiva vieja', texto: 'Recupera 5 MP.' });
    const nuevas = habilidadesDelKit(kitCompleto());
    expect(reemplazarKit(actuales, nuevas)).toEqual([...nuevas, otra]);
  });
});
