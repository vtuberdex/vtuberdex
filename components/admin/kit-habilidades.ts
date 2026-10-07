/**
 * El ASISTENTE DE KIT: de lo que el mantenedor elige en menús al HTML de las 5 habilidades.
 *
 * POR QUÉ EXISTE
 * --------------
 * Las habilidades se escribían con un «prompt maestro» para un agente, y aun así el resultado rompía
 * las reglas mecánicas (estado base en la Ultimate, «obtienes» con un negativo, colores aproximados;
 * ver `npm run informe:habilidades`). Aquí la persona decide lo CREATIVO —nombres, qué estados,
 * qué fórmula, qué dicen las pasivas y la Habilidad Única— y lo MECÁNICO sale del catálogo
 * (`server/src/habilidades.mjs`): el `<span>` y su color, el verbo según la polaridad, la evolución en
 * la Ultimate con sus efectos oficiales y los `<br>`. Lo que no se puede elegir de un menú se escribe
 * como texto con tokens `[[Estado]]`, que se convierten en el `<span>` oficial.
 *
 * Es puro (sin React) para probarlo sin montar nada; la pantalla es `kit-builder.tsx`.
 */
import type { SkillForm } from '@/components/admin/form-model';
import {
  ESTADOS,
  bloqueDeEvolucion,
  buscarEstado,
  escaparHtml,
  expandirEstados,
  spanDeEstado,
  textoPlanoDe,
  validarKit,
} from '@/server/src/habilidades.mjs';

export type Ataque = 'base' | 'magico' | 'ninguno';
export type Verbo = 'obtienes' | 'aplicas';

export interface EstadoElegido {
  /** Nombre canónico de la BASE ('' = ninguno). En la Ultimate se escribe su evolución. */
  nombre: string;
  /** Solo cuenta en los estados `ambos`; los demás llevan el verbo de su polaridad. */
  verbo: Verbo;
}

export interface ActivaForm {
  nombre: string;
  tipo: 'Ofensivo' | 'Defensivo' | 'Soporte';
  ataque: Ataque;
  bono: string;
  estado: EstadoElegido;
  turnos: string;
  /** Líneas adicionales, una por renglón, con tokens `[[Estado]]`. */
  extra: string;
}

export interface PasivaForm {
  nombre: string;
  texto: string;
}

export interface UnicaForm {
  activa: boolean;
  nombre: string;
  color: string;
  /** «Si el enemigo posee 3 o más estados negativos» (sin punto final) o vacío = siempre. */
  condicion: string;
  turnos: string;
  efectos: string;
}

export interface UltimateForm {
  nombre: string;
  formula: 'dado' | 'directo' | 'consecutivos';
  ataque: Exclude<Ataque, 'ninguno'>;
  bono: string;
  golpes: string;
  /** Solo en la fórmula de dado: cuántos dados (X = la suma) y de cuántas caras. */
  dados: '1' | '2';
  caras: CarasDelDado;
  estados: [EstadoElegido, EstadoElegido];
  turnos: string;
  extra: string;
  unica: UnicaForm;
}

export interface KitForm {
  activas: [ActivaForm, ActivaForm];
  pasivas: [PasivaForm, PasivaForm];
  ultimate: UltimateForm;
}

export type CarasDelDado = '4' | '6' | '8';

/**
 * Fórmula de dado: X ataques, y cada uno vale una FRACCIÓN del ataque según el tamaño del dado.
 *
 * Un dado más grande da más ataques posibles, así que cada uno vale menos: con 1d8 salen hasta 8 golpes y
 * a ataque completo serían el doble que un 1d4. La versión anterior era siempre «Lanza 1d6» con el ataque
 * entero más un bono, sin poder elegir el dado. Con 2 dados X es la suma (más ataques y más estables), y la
 * fracción sigue siendo la del tamaño del dado. Si el reparto cambia, se cambia aquí.
 */
export const FRACCION_DEL_DADO: Record<CarasDelDado, string> = { '4': 'la mitad', '6': 'un tercio', '8': 'un cuarto' };

/** Bonos de referencia del prompt: «normalmente +40, +45». */
export const BONO_ACTIVA = ['45', '40'] as const;
export const MP_ACTIVA = [90, 85] as const;
export const MP_ULTIMATE = 300;

const sinEstado = (): EstadoElegido => ({ nombre: '', verbo: 'aplicas' });

export function kitVacio(): KitForm {
  const activa = (bono: string): ActivaForm => ({ nombre: '', tipo: 'Ofensivo', ataque: 'base', bono, estado: sinEstado(), turnos: '2', extra: '' });
  return {
    activas: [activa(BONO_ACTIVA[0]), activa(BONO_ACTIVA[1])],
    pasivas: [
      { nombre: '', texto: '' },
      { nombre: '', texto: '' },
    ],
    ultimate: {
      nombre: '',
      formula: 'consecutivos',
      ataque: 'base',
      bono: '40',
      golpes: '4',
      dados: '1',
      caras: '6',
      estados: [sinEstado(), sinEstado()],
      turnos: '2',
      extra: '',
      unica: { activa: false, nombre: '', color: '#56bd45', condicion: '', turnos: '2', efectos: '' },
    },
  };
}

/**
 * HTML de una habilidad → texto con tokens: `<span>` de estado → `[[Nombre]]`, `<br>` → salto. Sirve
 * para precargar las pasivas de un kit que ya existe sin perder qué era un estado.
 */
export function aTokens(html: string | null | undefined): string {
  return textoPlanoDe(
    String(html ?? '').replace(/<span\s+style\s*=\s*"[^"]*"\s*>([^<]*)<\/span>/gi, (entero, nombre: string) => {
      const hallado = buscarEstado(nombre);
      return hallado ? `[[${hallado.canonico}]]` : nombre;
    }),
  );
}

/** Precarga lo que se puede leer sin interpretar: nombres, tipo de las activas y texto de las pasivas. */
export function kitDesdeHabilidades(skills: SkillForm[]): KitForm {
  const kit = kitVacio();
  const activas = skills.filter((s) => s.category === 'active');
  const pasivas = skills.filter((s) => s.category === 'passive');
  const ultimate = skills.find((s) => s.category === 'ultimate');
  activas.slice(0, 2).forEach((s, i) => {
    kit.activas[i].nombre = s.name;
    if (s.type === 'Defensivo' || s.type === 'Soporte') kit.activas[i].tipo = s.type;
  });
  pasivas.slice(0, 2).forEach((s, i) => {
    kit.pasivas[i] = { nombre: s.name, texto: aTokens(s.effectHtml ?? s.effect) };
  });
  if (ultimate) kit.ultimate.nombre = ultimate.name;
  return kit;
}

/** Estados que se pueden elegir: los exclusivos de una facción solo si la ficha la tiene. */
export function estadosDisponibles(facciones: string[]): Array<{ nombre: string; evolucion: string; polaridad: string; bloqueado: boolean }> {
  return ESTADOS.map((e) => ({
    nombre: e.nombre,
    evolucion: e.evolucion.nombre,
    polaridad: e.polaridad,
    bloqueado: Boolean(e.faccion && !facciones.includes(e.faccion)),
  }));
}

/** El verbo que corresponde: el de la polaridad, o el elegido si el estado es `ambos`. */
export function verboDe(elegido: EstadoElegido): Verbo {
  const hallado = buscarEstado(elegido.nombre);
  if (!hallado || hallado.estado.polaridad === 'ambos') return elegido.verbo;
  return hallado.estado.polaridad === 'positivo' ? 'obtienes' : 'aplicas';
}

const mayuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const formula = (ataque: Exclude<Ataque, 'ninguno'>, bono: string) =>
  `${ataque === 'magico' ? 'Ataque Mágico Base' : 'Ataque Base'} +${Number(bono) || 0}`;
const turnos = (n: string) => {
  const v = Math.max(1, Number(n) || 1);
  return `${v} ${v === 1 ? 'turno' : 'turnos'}`;
};

/** Texto libre → líneas con `<br>`: se escapa lo escrito y los `[[Estado]]` pasan a `<span>`. */
function lineas(texto: string): string[] {
  return texto
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => `${expandirEstados(escaparHtml(l))}<br>`);
}

export function htmlDeActiva(a: ActivaForm): string {
  const partes: string[] = [];
  const estado = a.estado.nombre ? `${verboDe(a.estado)} ${spanDeEstado(a.estado.nombre)} durante ${turnos(a.turnos)}` : '';
  if (a.ataque !== 'ninguno') {
    partes.push(`${formula(a.ataque, a.bono)}${estado ? ` y ${estado}` : ''}.<br>`);
  } else if (estado) {
    partes.push(`${mayuscula(estado)}.<br>`);
  }
  partes.push(...lineas(a.extra));
  return partes.join('\n');
}

export function htmlDePasiva(p: PasivaForm): string {
  return lineas(p.texto).join('\n');
}

export function htmlDeUltimate(u: UltimateForm): string {
  const partes: string[] = [];
  const dano = formula(u.ataque, u.bono);
  if (u.formula === 'dado') {
    const base = u.ataque === 'magico' ? 'Ataque Mágico Base' : 'Ataque Base';
    const caras = FRACCION_DEL_DADO[u.caras] ? u.caras : '6';
    const tirada = u.dados === '2' ? `Lanza 2d${caras}, donde X es la suma de los resultados.<br>` : `Lanza 1d${caras}, donde X es el resultado obtenido.<br>`;
    partes.push(tirada, `Realizas X ataques consecutivos equivalentes a ${FRACCION_DEL_DADO[caras]} del ${base}.<br>`);
  } else if (u.formula === 'consecutivos') {
    partes.push(`Realizas ${Math.max(2, Number(u.golpes) || 2)} ataques consecutivos equivalentes a ${dano}.<br>`);
  } else {
    partes.push(`${dano}.<br>`);
  }

  // Los dos estados SIEMPRE en su evolución: la regla de la Ultimate no se deja a elección.
  const elegidos = u.estados.filter((e) => e.nombre);
  if (elegidos.length) {
    const piezas = elegidos.map((e) => ({ verbo: verboDe(e), span: spanDeEstado(buscarEstado(e.nombre)!.estado.evolucion.nombre) }));
    const frase =
      piezas.length === 2 && piezas[0].verbo === piezas[1].verbo
        ? `${mayuscula(piezas[0].verbo)} ${piezas[0].span} y ${piezas[1].span}`
        : piezas.map((p, i) => `${i === 0 ? mayuscula(p.verbo) : p.verbo} ${p.span}`).join(' y ');
    partes.push(`\n<br>${frase} durante ${turnos(u.turnos)}.<br>`);
    for (const e of elegidos) partes.push(`\n${bloqueDeEvolucion(e.nombre)}`);
  }

  const extra = lineas(u.extra);
  if (extra.length) partes.push(`\n<br>${extra.join('\n')}`);

  const unica = u.unica;
  if (unica.activa && unica.nombre.trim()) {
    const color = /^#[0-9a-fA-F]{6}$/.test(unica.color) ? unica.color : '#56bd45';
    const span = `<span style="color:${color}; font-weight:bold;">${escaparHtml(unica.nombre.trim())}</span>`;
    const condicion = unica.condicion.trim().replace(/[.,]+$/, '');
    const activa = condicion
      ? `${escaparHtml(condicion)}, se activa la habilidad única ${span} durante ${turnos(unica.turnos)}.<br>`
      : `Se activa la habilidad única ${span} durante ${turnos(unica.turnos)}.<br>`;
    partes.push(`\n<br>${expandirEstados(activa)}`, `\n<br>Mientras ${span} esté activo:<br>`, ...lineas(unica.efectos));
  }
  return partes.join('\n');
}

/** El kit como las 5 filas del formulario, con su texto plano y su HTML. */
export function habilidadesDelKit(kit: KitForm): SkillForm[] {
  const fila = (category: SkillForm['category'], section: string, type: string, name: string, html: string): SkillForm => ({
    category,
    section,
    type,
    name: name.trim(),
    effect: textoPlanoDe(html),
    effectHtml: html,
    factions: [],
  });
  return [
    ...kit.activas.map((a) => fila('active', 'Active Skills', a.tipo, a.nombre, htmlDeActiva(a))),
    ...kit.pasivas.map((p) => fila('passive', 'Passive Skills', 'Pasivo', p.nombre, htmlDePasiva(p))),
    fila('ultimate', 'Ultimate Skill', 'Ultimate', kit.ultimate.nombre, htmlDeUltimate(kit.ultimate)),
  ];
}

/** Lo que falta por rellenar (antes de mirar las reglas del sistema). */
export function faltantes(kit: KitForm): string[] {
  const faltan: string[] = [];
  kit.activas.forEach((a, i) => {
    if (!a.nombre.trim()) faltan.push(`Nombre de la Activa ${i + 1}`);
    if (a.ataque === 'ninguno' && !a.estado.nombre && !a.extra.trim()) faltan.push(`Efecto de la Activa ${i + 1}`);
  });
  kit.pasivas.forEach((p, i) => {
    if (!p.nombre.trim()) faltan.push(`Nombre de la Pasiva ${i + 1}`);
    if (!p.texto.trim()) faltan.push(`Efecto de la Pasiva ${i + 1}`);
  });
  if (!kit.ultimate.nombre.trim()) faltan.push('Nombre de la Ultimate');
  if (kit.ultimate.estados.some((e) => !e.nombre)) faltan.push('Los dos estados de la Ultimate');
  else if (kit.ultimate.estados[0].nombre === kit.ultimate.estados[1].nombre) faltan.push('Dos estados DISTINTOS en la Ultimate');
  if (kit.ultimate.unica.activa && !kit.ultimate.unica.nombre.trim()) faltan.push('Nombre de la Habilidad Única');
  return faltan;
}

/** Validación completa del kit armado: lo que falta + las reglas del sistema (`validarKit`). */
export function revisarKit(kit: KitForm, facciones: string[]) {
  const habilidades = habilidadesDelKit(kit);
  const faltan = faltantes(kit);
  const estadosPendientes = faltan.some((f) => /estados/.test(f));
  const problemas = validarKit({
    habilidades: habilidades.map((h) => ({ category: h.category as 'active' | 'passive' | 'ultimate', name: h.name, effectHtml: h.effectHtml ?? '' })),
    facciones,
    // «Falta: los dos estados» ya lo dice; el «entrega 0 estados» del validador sería el mismo aviso dos veces.
  }).filter((p) => !(estadosPendientes && p.codigo === 'ultimate_estados'));
  return { habilidades, faltan, problemas };
}

/** Reemplaza el kit (activas, pasivas, Ultimate) del formulario y conserva las «otras» al final. */
export function reemplazarKit(actuales: SkillForm[], nuevas: SkillForm[]): SkillForm[] {
  return [...nuevas, ...actuales.filter((s) => s.category === 'other')];
}
