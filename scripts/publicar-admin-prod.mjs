/**
 * Publica la contraseña del mantenedor en producción y COMPRUEBA que entra de verdad.
 *
 * POR QUÉ EXISTE
 * --------------
 * Publicar la credencial son varios pasos encadenados y a mano se rompen dos veces:
 *
 *   · `admin-hash.mjs` imprime el valor DENTRO de un comando
 *     (`VTUBERDEX_ADMIN_PASSWORD_HASH='scrypt$...$...'`). Pegar la línea entera o el valor
 *     con las comillas mete ese carácter DENTRO del hash; `verifyPassword` parte por `$` y
 *     compara `'scrypt` contra `scrypt`, así que el login falla. Medido, no teórico.
 *   · Guardar la variable no cambia el despliegue que está sirviendo: Vercel hornea las
 *     variables por despliegue, así que sin un redeploy la función sigue con el hash anterior.
 *
 * Los dos fallos producen el MISMO `401 credenciales_invalidas` que una contraseña
 * equivocada. Este script los elimina de raíz: **el hash nunca se imprime ni se copia a
 * mano** (viaja por stdin hasta el CLI) y el redeploy es parte del mismo comando. Al final
 * comprueba el resultado con el login real, no con la intención.
 *
 * Uso:
 *   npm run admin:publicar                       # pide la contraseña sin mostrarla
 *   npm run admin:publicar -- --sin-redeploy     # solo sube la variable
 *   npm run admin:publicar -- --env-name OTRA    # para pruebas
 *
 * La contraseña se pide por TTY (oculta) y, sin TTY, por stdin —igual que `admin-hash.mjs`—:
 * nunca aparece en el historial, en la pantalla ni en un archivo.
 */
import { spawnSync } from 'node:child_process';
import readline from 'node:readline';

import { hashPassword, verifyPassword } from '../server/src/auth.mjs';

const args = process.argv.slice(2);
const tiene = (nombre) => args.includes(`--${nombre}`);
const opcion = (nombre, porDefecto) => {
  const i = args.indexOf(`--${nombre}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : porDefecto;
};

const NOMBRE = opcion('env-name', 'VTUBERDEX_ADMIN_PASSWORD_HASH');
const URL = opcion('url', 'https://vtuberdex.com').replace(/\/$/, '');
const USUARIO = opcion('user', process.env.VTUBERDEX_ADMIN_USER || 'admin');
const SIN_REDEPLOY = tiene('sin-redeploy');
const SIN_VERIFICAR = tiene('sin-verificar');
const COMO_SECRETO = tiene('sensitive');

const pasos = [];
const paso = (nombre, ok, detalle = '') => {
  pasos.push(ok);
  console.log(`${ok ? '✔' : '✖'} ${nombre}${detalle ? ` — ${detalle}` : ''}`);
};

/** Ejecuta el CLI de Vercel sin heredar la salida (puede contener el valor). */
function vercel(argumentos, entrada) {
  return spawnSync('vercel', argumentos, {
    input: entrada,
    encoding: 'utf8',
    stdio: [entrada === undefined ? 'inherit' : 'pipe', 'pipe', 'pipe'],
  });
}

/**
 * Pide la contraseña sin eco. Es la MISMA trampa que documenta `admin-hash.mjs`: sin TTY,
 * `rl.question` no recibe `line` nunca y el `await` se queda colgado (Node sale con
 * "unsettled top-level await" en vez de un error útil), así que se lee una línea de stdin.
 */
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
  return process.stdin.isTTY ? preguntarOculto(`Contraseña nueva para ${USUARIO}: `) : leerLineaDeStdin();
}

/** El deployment que está sirviendo producción, para redeployarlo. */
function ultimoDeploymentDeProduccion() {
  const salida = vercel(['ls', '--json']);
  let datos;
  try {
    datos = JSON.parse(salida.stdout || '{}');
  } catch {
    return null;
  }
  const lista = Array.isArray(datos.deployments) ? datos.deployments : [];
  const produccion = lista
    .filter((d) => d.target === 'production' && d.state === 'READY')
    .sort((a, b) => b.createdAt - a.createdAt);
  return produccion[0]?.url ? `https://${produccion[0].url}` : null;
}

async function pedir(ruta, init = {}) {
  const respuesta = await fetch(`${URL}${ruta}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const texto = await respuesta.text();
  let cuerpo = null;
  try {
    cuerpo = texto ? JSON.parse(texto) : null;
  } catch {
    cuerpo = null;
  }
  return { status: respuesta.status, cuerpo };
}

// --- 1. la contraseña ------------------------------------------------------
const password = await pedirCredencial();
if (!password || password.length < 8) {
  console.error('✖ la contraseña debe tener al menos 8 caracteres.');
  process.exit(1);
}

const hash = hashPassword(password);
// Ida y vuelta antes de subir nada: un hash que no valida dejaría el mantenedor inaccesible.
if (!verifyPassword(password, hash)) {
  console.error('✖ el hash generado no valida la contraseña (no se sube nada).');
  process.exit(1);
}
console.log(`\nPublicando el mantenedor de ${URL}\n`);

// --- 2. subir la variable -------------------------------------------------
/**
 * Se guarda como **Config** (`--no-sensitive`), NO como Secret, salvo que se pida con
 * `--sensitive`.
 *
 * Los valores *sensitive* quedan en un formato ILEGIBLE PARA SIEMPRE en Vercel: ni el CLI,
 * ni `vercel env pull`, ni la API con `decrypt=true` permiten releerlos. Un error de pegado
 * se vuelve indepurable. Un hash `scrypt` no es un secreto reutilizable —es irreversible y
 * con sal— así que guardarlo legible solo aporta: se puede comparar y rehacer. Con
 * `--sensitive` se conserva el comportamiento antiguo, pero entonces el diagnóstico del 401
 * (que solo describe la FORMA) pasa a ser la única herramienta de depuración.
 */
const TIPO = COMO_SECRETO ? '--sensitive' : '--no-sensitive';
const subida = vercel(['env', 'update', NOMBRE, 'production', TIPO, '--value', hash, '-y']);
if (subida.status !== 0) {
  // No existía: se crea.
  const creada = vercel(['env', 'add', NOMBRE, 'production', TIPO, '-y', '--force'], hash);
  paso(
    `la variable queda guardada en producción (${COMO_SECRETO ? 'secreta, ilegible' : 'legible'})`,
    creada.status === 0,
    creada.status === 0 ? NOMBRE : (creada.stderr || '').trim().slice(0, 200),
  );
} else {
  paso(`la variable queda guardada en producción (${COMO_SECRETO ? 'secreta, ilegible' : 'legible'})`, true, NOMBRE);
}

// --- 3. redeploy: SIN esto el cambio no llega a la función ----------------
if (SIN_REDEPLOY) {
  console.log('· redeploy omitido (--sin-redeploy): el despliegue que sirve conserva el hash anterior');
} else {
  const objetivo = ultimoDeploymentDeProduccion();
  if (!objetivo) {
    paso('se localiza el despliegue de producción a redeployar', false, 'no se pudo leer `vercel ls --json`');
  } else {
    console.log(`· redeployando ${objetivo} (Vercel hornea las variables por despliegue)`);
    const salida = vercel(['redeploy', objetivo, '--target', 'production']);
    const salidaTexto = `${salida.stdout ?? ''}${salida.stderr ?? ''}`;
    paso('el despliegue se recrea y queda sirviendo el alias', salida.status === 0 && /Aliased|Ready/.test(salidaTexto), salida.status === 0 ? 'hecho' : salidaTexto.trim().slice(-200));
  }
}

// --- 4. comprobar el resultado, no la intención ---------------------------
if (SIN_VERIFICAR) {
  console.log('· verificación omitida (--sin-verificar)');
} else {
  const login = await pedir('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username: USUARIO, password }),
  });
  const ok = login.status === 200 && Boolean(login.cuerpo?.token);
  paso('el login de producción entra con la credencial nueva', ok, `status=${login.status}`);

  if (ok) {
    const token = login.cuerpo.token;
    const stats = await pedir('/api/admin/stats', { headers: { authorization: `Bearer ${token}` } });
    paso('la sesión vale en otra petición (Turso la comparte entre instancias)', stats.status === 200, `status=${stats.status}`);
    await pedir('/api/admin/logout', { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    paso('la sesión de prueba queda cerrada', true);
  } else {
    console.log('');
    const d = login.cuerpo ?? {};
    if (typeof d.usuarioOk === 'boolean') {
      if (!d.usuarioOk) {
        console.log(`  El USUARIO no es el esperado: el campo pide "${d.usuarioEsperado}".`);
      }
      if (!d.claveOk) {
        console.log('  La CONTRASEÑA no corresponde al hash que quedó en producción.');
        if (d.hash?.valido) {
          console.log('  El hash está bien formado, así que el despliegue que sirve todavía no');
          console.log('  tiene el valor nuevo. Vuelve a correr sin `--sin-redeploy`.');
        } else {
          for (const p of d.hash?.problemas ?? []) console.log(`    · ${p}`);
        }
      }
    } else {
      console.log('  El despliegue que sirve producción es anterior al diagnóstico: vuelve a');
      console.log('  desplegar (vercel deploy --prod) antes de sacar conclusiones.');
    }
  }
}

const fallos = pasos.filter((ok) => !ok).length;
console.log(`\n${pasos.length - fallos}/${pasos.length} pasos correctos`);
if (fallos) process.exitCode = 1;
