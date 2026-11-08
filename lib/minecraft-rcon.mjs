/**
 * Cliente RCON del servidor de Minecraft para el mantenedor (`/minecraft-admin`).
 *
 * POR QUÉ ESTÁ AQUÍ
 * -----------------
 * El servidor ya tiene RCON activado (puerto 25575, solo accesible desde `lo` por una regla
 * de iptables del drop-in `rcon-local.conf`), pero hasta ahora solo se usaba desde la shell
 * con `mc-rcon`. El panel necesita lo mismo: ver quién juega, guardar el mundo, avisar o
 * expulsar sin abrir una terminal.
 *
 * REGLAS
 * ------
 * 1. La contraseña NO se escribe en el código ni viaja al navegador: sale de
 *    `VTUBERDEX_MINECRAFT_RCON_PASSWORD` (o de un archivo en `..._PASSWORD_FILE`).
 * 2. Solo se habla con `127.0.0.1` salvo que `VTUBERDEX_MINECRAFT_RCON_HOST` diga otra cosa:
 *    RCON no cifra nada.
 * 3. Las ACCIONES de un clic no son consola libre (la consola con comando libre, solo de admin y con
 *    lista blanca para el mantenedor, vive en `lib/minecraft-consola.mjs`). Aquí el navegador nunca manda un comando: manda el NOMBRE de una acción
 *    (`ACCIONES`) con sus datos, y el servidor construye el comando. Así `op`, `execute`,
 *    `function`… no se pueden alcanzar ni con un nombre de jugador o un motivo malicioso: los
 *    datos se validan estrictamente y nunca pueden contener saltos de línea ni abrir otro comando.
 *    (Un op dado por NOMBRE lo hereda quien use ese nombre en modo offline, y parar el servidor
 *    se hace con systemd; la única excepción es la acción fija `reiniciar`.)
 */
import fs from "node:fs";
import net from "node:net";

export const RCON_PUERTO_POR_DEFECTO = 25575;
export const RCON_TIMEOUT_MS = 8000;

const TIPO_AUTENTICAR = 3;
const TIPO_COMANDO = 2;

/** Arma un paquete RCON: largo, id, tipo, cuerpo y dos bytes nulos. */
export function paquete(id, tipo, cuerpo) {
  const datos = Buffer.from(`${cuerpo}\0\0`, "utf8");
  const salida = Buffer.alloc(12 + datos.length);
  salida.writeInt32LE(8 + datos.length, 0);
  salida.writeInt32LE(id, 4);
  salida.writeInt32LE(tipo, 8);
  datos.copy(salida, 12);
  return salida;
}

/** Nombre exacto de cuenta: Java (3-16) o Bedrock con «.» delante; algo más holgado, sin espacios. */
const JUGADOR_VALIDO = /^[A-Za-z0-9_.]{1,20}$/;

/** Texto libre (motivo, anuncio): una sola línea, sin caracteres de control. */
function textoLibre(valor, { maximo, obligatorio = false } = {}) {
  const texto = String(valor ?? "").trim();
  if (!texto) return obligatorio ? null : "";
  if (texto.length > maximo) return null;
  for (const caracter of texto) {
    const codigo = caracter.codePointAt(0);
    if (codigo <= 0x1f || codigo === 0x7f) return null;
  }
  return texto;
}

const invalido = (error, detail) => ({
  ok: false,
  status: 400,
  cuerpo: { error, detail },
});

const conJugador = (prefijo) => (datos) => {
  const jugador = String(datos.jugador ?? "").trim();
  if (!JUGADOR_VALIDO.test(jugador)) {
    return invalido(
      "jugador_invalido",
      "escribe el nombre exacto de la cuenta",
    );
  }
  return { ok: true, comando: `${prefijo} ${jugador}` };
};

const conJugadorYMotivo = (prefijo) => (datos) => {
  const base = conJugador(prefijo)(datos);
  if (!base.ok) return base;
  const motivo = textoLibre(datos.motivo, { maximo: 120 });
  if (motivo === null)
    return invalido("motivo_invalido", "una línea de hasta 120 caracteres");
  return {
    ok: true,
    comando: motivo ? `${base.comando} ${motivo}` : base.comando,
  };
};

const fija = (comando) => () => ({ ok: true, comando });

/**
 * TODO lo que el panel puede hacerle al servidor. `minimo` es el rol mínimo: las que cambian
 * el estado de forma difícil de deshacer (vetar) son solo de admin.
 */
export const ACCIONES = {
  jugadores: { minimo: "mantenedor", construir: fija("list") },
  // Único `stop` alcanzable, y solo como acción FIJA sin datos del cliente. El servicio de systemd
  // tiene `Restart=always`, así que parar el proceso equivale a reiniciarlo; Paper guarda el mundo
  // y despide a los jugadores al cerrar.
  reiniciar: { minimo: "mantenedor", construir: fija("stop") },
  tps: { minimo: "mantenedor", construir: fija("tps") },
  mspt: { minimo: "mantenedor", construir: fija("mspt") },
  guardar: { minimo: "mantenedor", construir: fija("save-all flush") },
  "lista-blanca-recargar": {
    minimo: "mantenedor",
    construir: fija("whitelist reload"),
  },
  dia: { minimo: "mantenedor", construir: fija("time set day") },
  "clima-despejado": { minimo: "mantenedor", construir: fija("weather clear") },
  plugins: { minimo: "mantenedor", construir: fija("plugins") },
  anunciar: {
    minimo: "mantenedor",
    construir: (datos) => {
      const mensaje = textoLibre(datos.mensaje, {
        maximo: 200,
        obligatorio: true,
      });
      if (!mensaje)
        return invalido(
          "mensaje_invalido",
          "una línea de hasta 200 caracteres",
        );
      return { ok: true, comando: `say ${mensaje}` };
    },
  },
  expulsar: { minimo: "mantenedor", construir: conJugadorYMotivo("kick") },
  "lista-blanca-anadir": {
    minimo: "mantenedor",
    construir: conJugador("whitelist add"),
  },
  "lista-blanca-quitar": {
    minimo: "mantenedor",
    construir: conJugador("whitelist remove"),
  },
  vetar: { minimo: "admin", construir: conJugadorYMotivo("ban") },
  "quitar-veto": { minimo: "admin", construir: conJugador("pardon") },
};

/** Busca la acción y construye su comando. Devuelve `{ ok, accion, comando }` o el rechazo. */
export function prepararAccion(nombre, datos = {}) {
  const definicion = Object.hasOwn(ACCIONES, String(nombre))
    ? ACCIONES[nombre]
    : null;
  if (!definicion)
    return invalido("accion_desconocida", "esa acción no existe");
  const construido = definicion.construir(
    datos && typeof datos === "object" ? datos : {},
  );
  if (!construido.ok) return construido;
  return {
    ok: true,
    accion: nombre,
    minimo: definicion.minimo,
    comando: construido.comando,
  };
}

/** Configuración de conexión desde el entorno; `null` si falta la contraseña. */
export function configuracionRcon(env = process.env) {
  let clave = env.VTUBERDEX_MINECRAFT_RCON_PASSWORD;
  if (!clave && env.VTUBERDEX_MINECRAFT_RCON_PASSWORD_FILE) {
    try {
      clave = fs
        .readFileSync(env.VTUBERDEX_MINECRAFT_RCON_PASSWORD_FILE, "utf8")
        .trim();
    } catch {
      clave = "";
    }
  }
  if (!clave) return null;
  const puerto =
    Number(env.VTUBERDEX_MINECRAFT_RCON_PORT) || RCON_PUERTO_POR_DEFECTO;
  return {
    host: env.VTUBERDEX_MINECRAFT_RCON_HOST || "127.0.0.1",
    puerto,
    clave,
  };
}

/**
 * Envía UN comando y devuelve su respuesta. Abre y cierra la conexión por comando: el panel
 * es de uso ocasional y así no queda un socket autenticado colgando.
 */
export function enviarRcon(
  comando,
  { env = process.env, conectar = net.connect } = {},
) {
  const config = configuracionRcon(env);
  if (!config) {
    return Promise.resolve({
      ok: false,
      status: 503,
      cuerpo: {
        error: "rcon_no_configurado",
        detail:
          "falta VTUBERDEX_MINECRAFT_RCON_PASSWORD en el entorno del servicio",
      },
    });
  }
  return new Promise((resolver) => {
    let terminado = false;
    let buffer = Buffer.alloc(0);
    let autenticado = false;
    const socket = conectar({ host: config.host, port: config.puerto });
    const terminar = (resultado) => {
      if (terminado) return;
      terminado = true;
      socket.destroy();
      resolver(resultado);
    };
    const falla = (detail) =>
      terminar({
        ok: false,
        status: 502,
        cuerpo: { error: "rcon_no_disponible", detail },
      });

    socket.setTimeout(RCON_TIMEOUT_MS, () => falla("tiempo de espera agotado"));
    socket.on("error", (e) => falla(e.message));
    socket.on("connect", () =>
      socket.write(paquete(1, TIPO_AUTENTICAR, config.clave)),
    );
    socket.on("data", (trozo) => {
      buffer = Buffer.concat([buffer, trozo]);
      while (buffer.length >= 4 && buffer.length >= buffer.readInt32LE(0) + 4) {
        const largo = buffer.readInt32LE(0);
        const id = buffer.readInt32LE(4);
        const cuerpo = buffer.subarray(12, 4 + largo - 2).toString("utf8");
        buffer = buffer.subarray(4 + largo);
        if (!autenticado) {
          if (id === -1) {
            terminar({
              ok: false,
              status: 502,
              cuerpo: { error: "rcon_clave_rechazada" },
            });
            return;
          }
          autenticado = true;
          socket.write(paquete(2, TIPO_COMANDO, comando));
        } else {
          terminar({ ok: true, respuesta: sinColores(cuerpo) });
          return;
        }
      }
    });
  });
}

/**
 * Quita los códigos de color de Minecraft (`§a`, `§r`, y los hexadecimales `§x§3§4§9§f§d§a`):
 * el servidor los manda en la respuesta de RCON y en el registro del panel salen como basura.
 * El registro es texto plano, así que se descartan en lugar de interpretarlos.
 */
export function sinColores(texto) {
  return String(texto)
    .replace(/§x(?:§[0-9a-fA-F]){6}/g, "")
    .replace(/§[0-9a-fk-orA-FK-OR]/g, "");
}

/** Construye y envía una acción. `ya` es la acción ya preparada (la ruta la usa para comprobar el rol antes). */
export async function ejecutarAccion(nombre, datos, opciones) {
  const preparada = prepararAccion(nombre, datos);
  if (!preparada.ok) return preparada;
  const resultado = await enviarRcon(preparada.comando, opciones);
  return resultado.ok
    ? { ...resultado, accion: nombre, comando: preparada.comando }
    : resultado;
}
