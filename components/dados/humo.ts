/**
 * Humo espectral del centro de cada dado: un cuadro que siempre mira a la cámara con ruido fbm
 * animado, que se suma como luz y cuyo color recorre el espectro poco a poco.
 *
 * POR QUÉ SIN PRUEBA DE PROFUNDIDAD: el cuerpo del dado es un material con TRANSMISIÓN, que escribe
 * profundidad; el humo está DENTRO, así que con la prueba activa la cara delantera lo taparía entero.
 * Se dibuja después (`renderOrder`) y sin probar profundidad: como el humo es más chico que el dado y
 * los dados no se tapan entre sí en la bandeja, se lee como luz que viene de dentro del cristal.
 * El color de la luz puntual que tiñe la mesa sale de la MISMA fórmula (`matizDelHumo`), para que el
 * reflejo en el tapete coincida con el humo.
 */
import { AdditiveBlending, Color, ShaderMaterial } from 'three';

export const HUMO = {
  /** Lo que tarda el color en dar la vuelta al espectro, en segundos. */
  periodoMatiz: 22,
  saturacion: 0.6,
  intensidad: 1.25,
  /** Tamaño del cuadro respecto del radio del dado. */
  escala: 1.25,
} as const;

/** Matiz (0–1) del humo de un dado en el instante `t` (s). `semilla` desfasa cada dado. */
export function matizDelHumo(semilla: number, t: number): number {
  // Razón áurea: semillas consecutivas caen en matices bien separados (con 0,137 casi daban la vuelta entera y
  // todos los dados salían del mismo morado).
  return (((semilla * 0.618034 + t / HUMO.periodoMatiz) % 1) + 1) % 1;
}

export function colorDelHumo(semilla: number, t: number, destino = new Color()): Color {
  return destino.setHSL(matizDelHumo(semilla, t), HUMO.saturacion, 0.6);
}

const VERTEX = /* glsl */ `
  uniform float uEscala;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 centro = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    centro.xy += position.xy * uEscala;
    gl_Position = projectionMatrix * centro;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uTiempo;
  uniform float uSemilla;
  uniform float uIntensidad;
  uniform float uSaturacion;
  uniform float uPeriodo;
  varying vec2 vUv;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float ruido(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int k = 0; k < 5; k++) {
      v += a * ruido(p);
      p = p * 2.03 + vec3(1.7, 9.2, 4.1);
      a *= 0.5;
    }
    return v;
  }
  vec3 hsl2rgb(float h, float s, float l) {
    vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return l + s * (rgb - 0.5) * (1.0 - abs(2.0 * l - 1.0));
  }

  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    if (r > 1.0) discard;
    float t = uTiempo;
    // Remolino: el ruido se tuerce alrededor del centro y sube despacio.
    float giro = 0.6 * sin(t * 0.35 + uSemilla) + r * 1.4;
    vec2 q = mat2(cos(giro), -sin(giro), sin(giro), cos(giro)) * p;
    float n = fbm(vec3(q * 1.7 + vec2(0.0, -t * 0.18), t * 0.22 + uSemilla));
    float hebras = smoothstep(0.42, 0.85, n);
    float borde = pow(1.0 - smoothstep(0.15, 1.0, r), 1.6);
    float nucleo = exp(-r * r * 9.0);
    float densidad = hebras * borde + nucleo * 0.32;

    // El matiz avanza con el tiempo y varía con la hebra: el humo muestra una franja del espectro.
    float h = fract(uSemilla * 0.618034 + t / uPeriodo + n * 0.35);
    vec3 color = mix(hsl2rgb(h, uSaturacion, 0.6), vec3(1.0), nucleo * 0.35);
    gl_FragColor = vec4(color * densidad * uIntensidad, 1.0);
  }
`;

export function crearMaterialDeHumo(semilla: number, radio: number): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uTiempo: { value: 0 },
      uSemilla: { value: semilla },
      uIntensidad: { value: HUMO.intensidad },
      uSaturacion: { value: HUMO.saturacion },
      uPeriodo: { value: HUMO.periodoMatiz },
      uEscala: { value: radio * HUMO.escala },
    },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
  });
}
