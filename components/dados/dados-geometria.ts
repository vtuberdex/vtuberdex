/**
 * Dados de rol (d4, d6, d8, d10, d12, d20): forma, numeración, bisel, orientación final y azar.
 *
 * PURO (solo matemática de three, sin DOM ni WebGL) para probarlo en jsdom: la escena
 * (`escena-dados.tsx`) y el atlas de números (`atlas.ts`) consumen lo que sale de aquí.
 *
 * EL RESULTADO NO LO DECIDE LA ANIMACIÓN
 * --------------------------------------
 * `tirar` saca el número con `crypto.getRandomValues` y rechazo (sin el sesgo del módulo) y DESPUÉS
 * se calcula la orientación que deja esa cara arriba (`orientacionFinal`). La animación es un tumbo
 * que converge a esa orientación, no una simulación física: con física el número saldría de la
 * geometría y del paso de integración (y obligaría a una dependencia de física solo para esto), y
 * lo que importa en una partida es que la tirada sea justa y que lo que se ve coincida con lo que
 * se anota. Así ambas cosas quedan garantizadas por construcción.
 *
 * FORMA
 * -----
 * Cada dado se define por sus VÉRTICES; las caras salen de su envolvente convexa agrupando los
 * triángulos coplanares (`carasDe`). El d10 es un trapezoedro pentagonal: sus cometas solo son
 * planas si el zigzag del anillo mide `H·(1−cos36°)/(1+cos36°)` (ver `verticesD10`).
 * El BISEL es la envolvente de cada cara encogida hacia su centro (`DADOS.bisel`): las caras quedan
 * un poco más chicas y entre ellas aparecen las tiras del bisel y un polígono en cada vértice.
 */
import { BufferGeometry, Float32BufferAttribute, Quaternion, Vector3 } from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';

export const TIPOS_DE_DADO = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'] as const;
export type TipoDeDado = (typeof TIPOS_DE_DADO)[number];

export const CARAS: Record<TipoDeDado, number> = { d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20 };

/** Perillas de los dados. Los valores visuales se calibraron mirando la escena renderizada. */
export const DADOS = {
  /** Fracción con que se encoge cada cara hacia su centro para formar el bisel. */
  bisel: 0.14,
  /** Radio (centro → vértice) de cada dado en unidades de mundo: los de menos caras se ven chicos si no. */
  radio: { d4: 1.08, d6: 0.92, d8: 0.98, d10: 0.98, d12: 0.98, d20: 1.02 } as Record<TipoDeDado, number>,
  /** Altura del d10 respecto de su radio: el real es algo más alto que ancho. */
  alturaD10: 1.1,
  /** Cuántos dados caben en la bandeja a la vez. */
  maximo: 10,
  /** Duración del tumbo (ms) y su variación por dado, para que no caigan todos a la vez. */
  duracionMs: 1700,
  variacionMs: 450,
} as const;

export interface Cara {
  normal: Vector3;
  centro: Vector3;
  vertices: Vector3[];
  /** Hacia dónde apunta la «parte de arriba» del número dentro de la cara. */
  arriba: Vector3;
  /** El número de la cara (en el d4, el de la cara opuesta al vértice: el d4 se lee en los VÉRTICES). */
  numero: number;
}

export interface FormaDeDado {
  tipo: TipoDeDado;
  caras: Cara[];
  /** Solo d4: vértices numerados; el resultado es el vértice que queda ARRIBA. */
  verticesNumerados: Array<{ punto: Vector3; numero: number }>;
}

const PHI = (1 + Math.sqrt(5)) / 2;

function verticesD10(): Vector3[] {
  const H = DADOS.alturaD10;
  const c36 = Math.cos(Math.PI / 5);
  const e = (H * (1 - c36)) / (1 + c36);
  const puntos = [new Vector3(0, H, 0), new Vector3(0, -H, 0)];
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5;
    puntos.push(new Vector3(Math.cos(a), i % 2 === 0 ? e : -e, Math.sin(a)));
  }
  return puntos;
}

function verticesBase(tipo: TipoDeDado): Vector3[] {
  const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
  const signos = [-1, 1];
  switch (tipo) {
    case 'd4':
      return [v(1, 1, 1), v(1, -1, -1), v(-1, 1, -1), v(-1, -1, 1)];
    case 'd6':
      return signos.flatMap((x) => signos.flatMap((y) => signos.map((z) => v(x, y, z))));
    case 'd8':
      return [v(1, 0, 0), v(-1, 0, 0), v(0, 1, 0), v(0, -1, 0), v(0, 0, 1), v(0, 0, -1)];
    case 'd10':
      return verticesD10();
    case 'd12':
      return [
        ...signos.flatMap((x) => signos.flatMap((y) => signos.map((z) => v(x, y, z)))),
        ...signos.flatMap((a) => signos.flatMap((b) => [v(0, a / PHI, b * PHI), v(a / PHI, b * PHI, 0), v(a * PHI, 0, b / PHI)])),
      ];
    case 'd20':
      return signos.flatMap((a) => signos.flatMap((b) => [v(0, a, b * PHI), v(a, b * PHI, 0), v(a * PHI, 0, b)]));
  }
}

/** Escala los vértices para que el más lejano quede a `radio` del centro. */
function escalar(puntos: Vector3[], radio: number): Vector3[] {
  const max = Math.max(...puntos.map((p) => p.length()));
  return puntos.map((p) => p.clone().multiplyScalar(radio / max));
}

/** Caras de la envolvente convexa: triángulos coplanares fundidos en un polígono ordenado. */
export function carasDe(puntos: Vector3[]): Array<{ normal: Vector3; centro: Vector3; vertices: Vector3[] }> {
  const hull = new ConvexHull().setFromPoints(puntos);
  const grupos: Array<{ normal: Vector3; vertices: Vector3[] }> = [];
  for (const face of hull.faces) {
    let grupo = grupos.find((g) => g.normal.dot(face.normal) > 0.9999);
    if (!grupo) {
      grupo = { normal: face.normal.clone(), vertices: [] };
      grupos.push(grupo);
    }
    let edge = face.edge;
    do {
      const p = edge.head().point;
      if (!grupo.vertices.some((q) => q.distanceToSquared(p) < 1e-10)) grupo.vertices.push(p.clone());
      edge = edge.next;
    } while (edge !== face.edge);
  }
  return grupos.map(({ normal, vertices }) => {
    const centro = vertices.reduce((acc, p) => acc.add(p), new Vector3()).multiplyScalar(1 / vertices.length);
    // Orden angular alrededor de la normal (antihorario visto desde fuera).
    const u = vertices[0].clone().sub(centro).normalize();
    const w = new Vector3().crossVectors(normal, u);
    const ordenados = [...vertices].sort((a, b) => {
      const da = a.clone().sub(centro);
      const db = b.clone().sub(centro);
      return Math.atan2(da.dot(w), da.dot(u)) - Math.atan2(db.dot(w), db.dot(u));
    });
    return { normal, centro, vertices: ordenados };
  });
}

/**
 * Hacia dónde mira el número: en un cuadrado, hacia el centro de un lado (si no, saldría girado 45°);
 * en el resto, hacia el vértice más lejano del centro (en la cometa del d10, el polo).
 */
function arribaDe(centro: Vector3, vertices: Vector3[]): Vector3 {
  const distancias = vertices.map((p) => p.distanceTo(centro));
  const regular = Math.max(...distancias) - Math.min(...distancias) < 1e-6;
  if (regular && vertices.length === 4) {
    return vertices[0].clone().add(vertices[1]).multiplyScalar(0.5).sub(centro).normalize();
  }
  const i = distancias.indexOf(Math.max(...distancias));
  return vertices[i].clone().sub(centro).normalize();
}

/**
 * Numeración: las caras OPUESTAS suman N+1, como en un dado real (1–6, 2–5…). En el d4 no hay caras
 * opuestas: se numeran los vértices y cada cara lleva el número del vértice que tiene enfrente.
 */
function numerar(tipo: TipoDeDado, crudas: ReturnType<typeof carasDe>, puntos: Vector3[]): FormaDeDado {
  const n = CARAS[tipo];
  if (tipo === 'd4') {
    const verticesNumerados = puntos.map((punto, i) => ({ punto, numero: i + 1 }));
    const caras = crudas.map((c) => {
      const opuesto = verticesNumerados.find((v) => !c.vertices.some((p) => p.distanceToSquared(v.punto) < 1e-10))!;
      return { ...c, arriba: arribaDe(c.centro, c.vertices), numero: opuesto.numero };
    });
    return { tipo, caras, verticesNumerados };
  }
  const numeros = new Array<number>(crudas.length).fill(0);
  let siguiente = 1;
  crudas.forEach((c, i) => {
    if (numeros[i]) return;
    const j = crudas.findIndex((o, k) => k !== i && !numeros[k] && o.normal.dot(c.normal) < -0.9999);
    numeros[i] = siguiente;
    if (j >= 0) numeros[j] = n + 1 - siguiente;
    siguiente++;
  });
  const caras = crudas.map((c, i) => ({ ...c, arriba: arribaDe(c.centro, c.vertices), numero: numeros[i] }));
  return { tipo, caras, verticesNumerados: [] };
}

const FORMAS = new Map<TipoDeDado, FormaDeDado>();

export function formaDe(tipo: TipoDeDado): FormaDeDado {
  let forma = FORMAS.get(tipo);
  if (!forma) {
    const puntos = escalar(verticesBase(tipo), DADOS.radio[tipo]);
    forma = numerar(tipo, carasDe(puntos), puntos);
    FORMAS.set(tipo, forma);
  }
  return forma;
}

/** Casilla del atlas de cada cara (en orden de `caras`); la última, vacía, es la del bisel. */
export function rejillaDelAtlas(tipo: TipoDeDado): { lado: number; casillas: number } {
  const casillas = formaDe(tipo).caras.length + 1;
  return { lado: Math.ceil(Math.sqrt(casillas)), casillas };
}

/** Margen dentro de la casilla: la cara no llega al borde para que el filtrado no mezcle vecinas. */
const MARGEN = 0.92;

/**
 * Coordenadas de un punto de la cara en el atlas, en [0,1]². `u` va a la derecha y `v` hacia arriba
 * del número, con `u × v = normal`: visto desde FUERA el número no sale espejado.
 */
export function uvEnCara(tipo: TipoDeDado, indice: number, punto: Vector3): [number, number] {
  const forma = formaDe(tipo);
  const cara = forma.caras[indice];
  const { lado } = rejillaDelAtlas(tipo);
  const R = Math.max(...cara.vertices.map((p) => p.distanceTo(cara.centro)));
  const v = cara.arriba;
  const u = new Vector3().crossVectors(v, cara.normal);
  const d = punto.clone().sub(cara.centro);
  const pu = d.dot(u) / R;
  const pv = d.dot(v) / R;
  const col = indice % lado;
  const fila = Math.floor(indice / lado);
  return [(col + 0.5 + 0.5 * MARGEN * pu) / lado, 1 - (fila + 0.5 - 0.5 * MARGEN * pv) / lado];
}

/**
 * La malla biselada, con UV al atlas: cada triángulo que cae sobre una cara original apunta a la
 * casilla de esa cara; los del bisel, al centro de la casilla vacía (liso, sin número).
 */
export function geometriaBiselada(tipo: TipoDeDado): BufferGeometry {
  const forma = formaDe(tipo);
  const puntos = forma.caras.flatMap((c) => c.vertices.map((p) => c.centro.clone().lerp(p, 1 - DADOS.bisel)));
  const convexa = new ConvexGeometry(puntos);
  const pos = convexa.getAttribute('position');
  const { lado, casillas } = rejillaDelAtlas(tipo);
  const vacia = casillas - 1;
  const uvVacia: [number, number] = [((vacia % lado) + 0.5) / lado, 1 - (Math.floor(vacia / lado) + 0.5) / lado];
  const uvs: number[] = [];
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    const normal = new Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
    const indice = forma.caras.findIndex((cara) => cara.normal.dot(normal) > 0.9995);
    for (const p of [a, b, c]) uvs.push(...(indice >= 0 ? uvEnCara(tipo, indice, p) : uvVacia));
  }
  const geometria = new BufferGeometry();
  geometria.setAttribute('position', pos.clone());
  geometria.setAttribute('normal', convexa.getAttribute('normal').clone());
  geometria.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  convexa.dispose();
  return geometria;
}

const ARRIBA = new Vector3(0, 1, 0);

/** La dirección local que debe quedar hacia arriba para mostrar `resultado`. */
export function direccionDelResultado(tipo: TipoDeDado, resultado: number): Vector3 {
  const forma = formaDe(tipo);
  if (tipo === 'd4') {
    const v = forma.verticesNumerados.find((x) => x.numero === resultado);
    if (!v) throw new Error(`resultado_invalido: ${tipo} ${resultado}`);
    return v.punto.clone().normalize();
  }
  const cara = forma.caras.find((x) => x.numero === resultado);
  if (!cara) throw new Error(`resultado_invalido: ${tipo} ${resultado}`);
  return cara.normal.clone();
}

/** Orientación en reposo que deja `resultado` arriba, girada `giro` radianes sobre la vertical. */
export function orientacionFinal(tipo: TipoDeDado, resultado: number, giro: number): Quaternion {
  const alinear = new Quaternion().setFromUnitVectors(direccionDelResultado(tipo, resultado), ARRIBA);
  return new Quaternion().setFromAxisAngle(ARRIBA, giro).multiply(alinear);
}

/** Lo que el dado baja por debajo de su centro en esa orientación: a esa altura se apoya en la mesa. */
export function alturaDeApoyo(tipo: TipoDeDado, orientacion: Quaternion): number {
  const forma = formaDe(tipo);
  let minimo = Infinity;
  for (const cara of forma.caras) {
    for (const p of cara.vertices) minimo = Math.min(minimo, p.clone().lerp(cara.centro, DADOS.bisel).applyQuaternion(orientacion).y);
  }
  return -minimo;
}

/** Entero uniforme en [1, caras], sin sesgo de módulo. */
export function tirar(caras: number, aleatorio: (buffer: Uint32Array) => Uint32Array = (b) => crypto.getRandomValues(b)): number {
  const limite = Math.floor(0x1_0000_0000 / caras) * caras;
  const buffer = new Uint32Array(1);
  for (;;) {
    const x = aleatorio(buffer)[0];
    if (x < limite) return (x % caras) + 1;
  }
}

/** «2d6 + 1d20» a partir de la bandeja (agrupado y en el orden de `TIPOS_DE_DADO`). */
export function expresionDe(tipos: TipoDeDado[]): string {
  return TIPOS_DE_DADO.filter((t) => tipos.includes(t))
    .map((t) => `${tipos.filter((x) => x === t).length}${t}`)
    .join(' + ');
}
