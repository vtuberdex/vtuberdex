/**
 * Genera el hash de la contraseña del mantenedor para PRODUCCIÓN.
 *
 * Por qué existe: la base que se despliega va saneada (sin `admin_user`), así que la
 * credencial de producción no puede vivir ahí. Vive en la variable de entorno
 * `VTUBERDEX_ADMIN_PASSWORD_HASH`, y este script es el que produce su valor con el MISMO
 * formato `scrypt` que usa el seed local, para que `verifyPassword` acepte los dos sin
 * ramas distintas.
 *
 * Uso:
 *   node scripts/admin-hash.mjs                      # pide la contraseña sin mostrarla
 *   node scripts/admin-hash.mjs "mi contraseña"      # atajo (queda en el historial)
 *   printf '%s' "mi contraseña" | node scripts/admin-hash.mjs   # por stdin, sin historial
 *
 * Desde la raíz también vale `npm run admin:hash` (y desde cualquier subcarpeta: npm
 * sube solo hasta el package.json, así que no hay que contar `cd`s).
 *
 * NO guarda nada: imprime el hash y el comando de Vercel para pegarlo.
 */
import crypto from 'node:crypto';
import readline from 'node:readline';

import { hashPassword } from '../server/src/auth.mjs';

/** Pide la contraseña sin eco (no queda en el historial ni en la pantalla). */
function preguntarOculto(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Se oculta el eco: sin esto la contraseña se ve mientras se escribe.
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
 * Sin TTY (redirección, CI, pipe) no se puede ocultar el eco NI leer una respuesta:
 * `rl.question` no recibe `line` nunca y el `await` de arriba quedaba colgado, con
 * Node saliendo por el aviso "unsettled top-level await" en lugar de un error útil.
 * Se lee una línea cruda de stdin, que es lo que espera quien hace
 * `printf '%s' "$CLAVE" | npm run admin:hash`.
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

const deArgumento = process.argv[2];
let password = deArgumento;
if (password === undefined) {
  if (process.stdin.isTTY) {
    password = await preguntarOculto('Contraseña del mantenedor: ');
  } else {
    password = await leerLineaDeStdin();
    if (!password) {
      console.error('✖ stdin no es un terminal y no llegó ninguna contraseña.');
      console.error('  Pásala como argumento (node scripts/admin-hash.mjs "<clave>")');
      console.error('  o por stdin (printf \'%s\' "<clave>" | npm run admin:hash).');
      process.exit(1);
    }
  }
}

if (!password || password.length < 8) {
  console.error('✖ la contraseña debe tener al menos 8 caracteres.');
  process.exit(1);
}

const hash = hashPassword(password);
// Comprobación de ida y vuelta: que el hash que se va a pegar en producción valide de
// verdad. Sin esto, un hash mal copiado daría un login imposible de depurar.
const { verifyPassword } = await import('../server/src/auth.mjs');
if (!verifyPassword(password, hash)) {
  console.error('✖ el hash generado no valida la contraseña (no lo uses).');
  process.exit(1);
}

const alfabeto = crypto.randomBytes(3).toString('hex');
console.log('');
console.log('Hash generado y verificado (scrypt, sal aleatoria):');
console.log('');
console.log(`  VTUBERDEX_ADMIN_PASSWORD_HASH='${hash}'`);
console.log('');
console.log('Pégalo en Vercel (el valor no se muestra después de guardarlo):');
console.log('');
console.log(`  printf '%s' '${hash}' | npx vercel env add VTUBERDEX_ADMIN_PASSWORD_HASH production`);
console.log('');
console.log(`(referencia para no confundir hashes: ${alfabeto})`);
console.log('');
console.log('El usuario por defecto es `admin`. Para cambiarlo, define VTUBERDEX_ADMIN_USER.');
console.log('La contraseña NO se ha guardado en ningún archivo.');
