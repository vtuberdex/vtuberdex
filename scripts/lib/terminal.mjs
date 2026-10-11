/**
 * Utilidades de terminal compartidas por los scripts del mantenedor (`admin-hash`,
 * `verificar-admin-prod`, `aplicar-ficha-prod`): leer opciones `--nombre valor`, pedir la
 * contraseña sin mostrarla y hablar con la API de producción sin lanzar por un status no-2xx.
 */
import readline from 'node:readline';

/** Lee `--nombre valor` y `--bandera` de una lista de argumentos (por defecto, los del proceso). */
export function leerOpciones(args = process.argv.slice(2)) {
  return {
    tiene: (nombre) => args.includes(`--${nombre}`),
    opcion: (nombre, porDefecto) => {
      const i = args.indexOf(`--${nombre}`);
      return i >= 0 && args[i + 1] ? args[i + 1] : porDefecto;
    },
  };
}

/** Pide la contraseña sin eco (no queda en el historial ni en la pantalla). */
export function preguntarOculto(prompt) {
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
 * `rl.question` no recibe `line` nunca y el `await` quedaba colgado, con Node saliendo por
 * el aviso "unsettled top-level await" en lugar de un error útil. Se lee una línea cruda de
 * stdin, que es lo que espera quien hace `printf '%s' "$CLAVE" | npm run admin:hash`.
 */
export function leerLineaDeStdin() {
  return new Promise((resolve) => {
    let datos = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (trozo) => {
      datos += trozo;
    });
    process.stdin.on('end', () => resolve(datos.split('\n')[0].trim()));
  });
}

/** La contraseña: oculta si hay TTY; si no, la primera línea de stdin. */
export function pedirCredencial(prompt = 'Contraseña del mantenedor: ') {
  return process.stdin.isTTY ? preguntarOculto(prompt) : leerLineaDeStdin();
}

/**
 * `fetch` que devuelve `{ status, cuerpo }` sin lanzar por un status no-2xx: el status es el
 * dato. El cuerpo va como JSON; si no lo es, `siNoEsJson(texto)` decide qué guardar.
 */
export async function pedirJson(url, init = {}, siNoEsJson = (texto) => texto) {
  const respuesta = await fetch(url, init);
  const texto = await respuesta.text();
  let cuerpo = null;
  try {
    cuerpo = texto ? JSON.parse(texto) : null;
  } catch {
    cuerpo = siNoEsJson(texto);
  }
  return { status: respuesta.status, cuerpo };
}
