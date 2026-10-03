/**
 * Comprueba que el mantenedor de PRODUCCIÓN acepta de verdad la credencial nueva.
 *
 * POR QUÉ EXISTE
 * --------------
 * Publicar la contraseña en Vercel son DOS pasos y solo existía el primero:
 * `admin-hash.mjs` genera el valor y `vercel env add` lo guarda, pero **Vercel hornea las
 * variables de entorno por despliegue** ("Changes to environment variables are not applied
 * to previous deployments. You must redeploy your project"). Guardar el hash no cambia el
 * despliegue que está sirviendo: el login sigue comparando contra el hash anterior, y como
 * el mensaje es un 401 idéntico al de una contraseña equivocada, el síntoma que llega es
 * "actualicé la contraseña y me dice credenciales inválidas" sin más pistas.
 *
 * Este script cierra ese hueco comprobando el resultado y no la intención: pide el login de
 * verdad y, si hay token, lo usa contra una ruta con sesión (lo que además demuestra que la
 * sesión se guardó en Turso y que la instancia siguiente la lee). Al terminar, cierra la
 * sesión para no dejar una fila viva en `sesion_admin`.
 *
 * Uso:
 *   node scripts/verificar-admin-prod.mjs                    # pide la contraseña sin mostrarla
 *   node scripts/verificar-admin-prod.mjs --url https://...  # contra otro despliegue
 *   printf '%s' "$CLAVE" | node scripts/verificar-admin-prod.mjs --hash "$HASH"
 *
 * Con `--hash` se comprueba ADEMÁS el valor pegado, sin red: reproduce la comparación de
 * `verifyPassword` en local, así que distingue "el hash está mal pegado" de "la contraseña
 * no es la del hash". La contraseña no se imprime nunca, ni se guarda en ningún archivo.
 */
import readline from 'node:readline';

import { formatoDeHash } from '../lib/admin-auth.mjs';
import { verifyPassword } from '../server/src/auth.mjs';

/** Alias de producción del proyecto. Se puede apuntar a otro con `--url`. */
const URL_POR_DEFECTO = 'https://vtuberdex.com';

const args = process.argv.slice(2);
const opcion = (nombre, porDefecto) => {
  const i = args.indexOf(`--${nombre}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : porDefecto;
};

const base = opcion('url', URL_POR_DEFECTO).replace(/\/$/, '');
const usuario = opcion('user', process.env.VTUBERDEX_ADMIN_USER || 'admin');
const hashPegado = opcion('hash', null);

const resultados = [];
const comprobar = (nombre, ok, detalle = '') => {
  resultados.push({ nombre, ok });
  console.log(`${ok ? '✔' : '✖'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
};

/** Pide la contraseña sin eco (no queda en pantalla ni en el historial). */
function preguntarOculto(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const escribirOriginal = rl._writeToOutput?.bind(rl);
    rl._writeToOutput = function _oculto(texto) {
      if (escribirOriginal && texto !== '\r\n' && texto !== '\n') return escribirOriginal('');
      return escribirOriginal ? escribirOriginal(texto) : undefined;
    };
    rl.question('', (respuesta) => {
      rl.close();
      process.stdout.write('\n');
      resolve(respuesta);
    });
  });
}

/**
 * Sin TTY hay que leer una línea cruda: `readline.question` no recibe `line` nunca y el
 * `await` se queda colgado (Node sale con "unsettled top-level await" en vez de un error).
 * Es la misma trampa que documenta `admin-hash.mjs`.
 */
function leerLineaDeStdin() {
  return new Promise((resolve) => {
    let datos = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (trozo) => {
      datos += trozo;
    });
    process.stdin.on('end', () => resolve(datos.split('\n')[0].trim()));
  });
}

async function pedirCredencial() {
  return process.stdin.isTTY ? preguntarOculto('Contraseña del mantenedor: ') : leerLineaDeStdin();
}

/** POST/GET contra producción sin lanzar por un status no-2xx: el status es el dato. */
async function pedir(ruta, init = {}) {
  const respuesta = await fetch(`${base}${ruta}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const texto = await respuesta.text();
  let cuerpo = null;
  try {
    cuerpo = texto ? JSON.parse(texto) : null;
  } catch {
    cuerpo = { crudo: texto.slice(0, 200) };
  }
  return { status: respuesta.status, cuerpo };
}

const password = await pedirCredencial();
if (!password) {
  console.error('✖ no llegó ninguna contraseña (¿stdin sin datos? Pásala por argumento no existe a propósito: usa un pipe).');
  process.exit(2);
}

console.log(`\nComprobando el mantenedor de ${base}\n`);

// 1. El valor pegado, si se pasó el hash. Sin red: es la comparación real de `verifyPassword`.
if (hashPegado) {
  const forma = formatoDeHash(hashPegado);
  const valida = verifyPassword(password, hashPegado);
  comprobar(
    'el hash pegado valida la contraseña localmente',
    valida,
    valida ? 'el valor está completo y sin adornos' : `revisa el pegado: ${forma.problemas.join('; ') || 'el valor tiene la forma correcta, así que la contraseña no es la que generó este hash'}`,
  );
}

// 2. El login de verdad. Aquí está el fallo que este script existe para cazar: sin
//    redeploy, la variable nueva no llega a la función y esto da 401.
const login = await pedir('/api/admin/login', {
  method: 'POST',
  body: JSON.stringify({ username: usuario, password }),
});
const okLogin = login.status === 200 && Boolean(login.cuerpo?.token);
comprobar('el login de producción acepta la credencial', okLogin, `status=${login.status}`);

if (!okLogin) {
  console.log('');
  const d = login.cuerpo ?? {};
  if (typeof d.usuarioOk === 'boolean') {
    // El despliegue ya trae el diagnóstico: se dice QUÉ mitad falló, que es lo único que
    // permite arreglarlo sin adivinar (el valor guardado no se puede leer).
    if (!d.usuarioOk) {
      console.log(`  El USUARIO no es el esperado. El campo de usuario pide "${d.usuarioEsperado}".`);
      console.log('  Escribe ese usuario exacto (sin espacios) en el formulario del mantenedor.');
    }
    if (!d.claveOk) {
      console.log('  La CONTRASEÑA no corresponde al hash que hay en producción.');
      if (d.hash?.valido) {
        console.log('  El hash guardado está bien formado, así que es la contraseña: o el');
        console.log('  despliegue que sirve es anterior al cambio, o la clave escrita no es la');
        console.log('  que generó el hash. Vuelve a publicarla: npm run admin:publicar');
      } else {
        for (const p of d.hash?.problemas ?? ['el hash guardado no se pudo leer']) console.log(`    · ${p}`);
      }
    }
  } else {
    // Sin campos de diagnóstico: la función desplegada es anterior a esta versión del código.
    // Es un dato, no un fallo del script.
    console.log('  La respuesta no trae diagnóstico: el despliegue que sirve producción es');
    console.log('  ANTERIOR a esta versión del código del mantenedor.');
  }
  console.log('');
  console.log('  La forma correcta de publicarla (sin copiar/pegar el hash a mano):');
  console.log('    npm run admin:publicar');
  console.log('  Ese comando sube el hash por stdin, redeploya —Vercel hornea las variables por');
  console.log('  despliegue, y el que ya servía conserva el hash anterior— y comprueba el login.');
  console.log('  Guarda el hash como Config (legible): los valores *sensitive* quedan ilegibles');
  console.log('  para siempre en Vercel, así que un error de pegado no se puede depurar.');
  process.exit(1);
}

// 3. La sesión tiene que valer en otra petición: si no se guardó en Turso, la instancia
//    siguiente no la reconocería y el mantenedor echaría al usuario en la petición siguiente.
const token = login.cuerpo.token;
const stats = await pedir('/api/admin/stats', { headers: { authorization: `Bearer ${token}` } });
comprobar(
  'la sesión vale para una petición con sesión (y sobrevive en Turso)',
  stats.status === 200,
  `status=${stats.status}`,
);

// 4. Cerrar la sesión: no dejar filas vivas en `sesion_admin` por una comprobación.
const salida = await pedir('/api/admin/logout', {
  method: 'POST',
  headers: { authorization: `Bearer ${token}` },
});
comprobar('la sesión se cierra al terminar la comprobación', salida.status === 200, `status=${salida.status}`);

const fallos = resultados.filter((r) => !r.ok).length;
console.log(`\n${resultados.length - fallos}/${resultados.length} comprobaciones pasan`);
if (fallos) process.exitCode = 1;
