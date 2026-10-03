/**
 * Aplica a PRODUCCIÓN un parche de ficha (un JSON con los campos de `vtuberUpdateSchema`) y
 * COMPRUEBA que quedó publicado.
 *
 * POR QUÉ EXISTE
 * --------------
 * Completar una ficha son ocho campos (frase, perfil, redes, facciones…). A mano son ocho pasos
 * del asistente y un typo cada vez; aquí es un archivo revisable en el repo que se valida con el
 * MISMO esquema que valida el servidor y se aplica de una vez por la API del mantenedor.
 *
 * Uso:
 *   npm run ficha:prod -- --slug madkoding --file scripts/ficha-madkoding.json            # ensayo
 *   npm run ficha:prod -- --slug madkoding --file scripts/ficha-madkoding.json --aplicar  # escribe
 *   (opciones: --url https://vtuberdex.com  --user admin)
 *
 * SIN `--aplicar` NO ESCRIBE NADA: valida el archivo y muestra qué cambiaría respecto de lo que
 * hoy sirve producción. La contraseña se pide por TTY (oculta) y, sin TTY, por stdin; nunca se
 * guarda ni se imprime. Un `PATCH` reemplaza las listas completas (perfil, redes, facciones):
 * lo que el archivo no traiga en una lista que SÍ menciona, se pierde.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import { formatIssues, vtuberUpdateSchema } from '../server/src/validation.mjs';

const args = process.argv.slice(2);
const tiene = (nombre) => args.includes(`--${nombre}`);
const opcion = (nombre, porDefecto) => {
  const i = args.indexOf(`--${nombre}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : porDefecto;
};

const URL_BASE = opcion('url', 'https://vtuberdex.com').replace(/\/$/, '');
const USUARIO = opcion('user', process.env.VTUBERDEX_ADMIN_USER || 'admin');
const SLUG = opcion('slug', null);
const ARCHIVO = opcion('file', null);
const APLICAR = tiene('aplicar');

if (!SLUG || !ARCHIVO) {
  console.error('Uso: npm run ficha:prod -- --slug <slug> --file <parche.json> [--aplicar]');
  process.exit(1);
}

/* --------------------------------------------------------------- el parche */
let crudo;
try {
  crudo = JSON.parse(fs.readFileSync(path.resolve(ARCHIVO), 'utf8'));
} catch (error) {
  console.error(`✖ no se pudo leer ${ARCHIVO}: ${error.message}`);
  process.exit(1);
}
const validado = vtuberUpdateSchema.safeParse(crudo);
if (!validado.success) {
  console.error('✖ el archivo no cumple el esquema del mantenedor:');
  for (const { path: ruta, message } of formatIssues(validado.error)) console.error(`  · ${ruta}: ${message}`);
  process.exit(1);
}
const parche = validado.data;
console.log(`✔ ${ARCHIVO} válido (${Object.keys(parche).length} campos: ${Object.keys(parche).join(', ')})`);

/* ------------------------------------------------------------ credenciales */
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

async function pedir(ruta, { token, ...init } = {}) {
  const cabeceras = { 'content-type': 'application/json' };
  if (token) cabeceras.authorization = ['Bearer', token].join(' ');
  const respuesta = await fetch(`${URL_BASE}${ruta}`, { ...init, headers: cabeceras });
  const texto = await respuesta.text();
  let cuerpo = null;
  try {
    cuerpo = texto ? JSON.parse(texto) : null;
  } catch {
    cuerpo = texto;
  }
  return { status: respuesta.status, cuerpo };
}

/* ------------------------------------------------------------ lo que hay hoy */
const actual = await pedir(`/api/vtubers/${encodeURIComponent(SLUG)}`);
if (actual.status !== 200) {
  console.error(`✖ producción no sirve la ficha «${SLUG}» (status ${actual.status}). ¿Está publicada?`);
  process.exit(1);
}
const hoy = actual.cuerpo;
const resumir = (valor) => (valor === null || valor === undefined || (Array.isArray(valor) && valor.length === 0) ? '(vacío)' : JSON.stringify(valor));
const proyeccion = {
  phrase: hoy.phrase,
  birthday: hoy.birthday,
  height: hoy.height,
  hashtag: hoy.hashtag,
  favoriteColor: hoy.favoriteColor,
  languages: hoy.languages,
  factions: hoy.factionIcons?.map((f) => f.slug) ?? [],
  profile: hoy.profile,
  socials: hoy.socials?.map((s) => ({ platform: s.platform, label: s.label, url: s.url })),
  stats: hoy.stats,
  skills: hoy.skills,
};
console.log(`\nFicha «${hoy.name}» (#${hoy.dexNumber}, id ${hoy.id}) — cambios respecto de producción:`);
for (const campo of Object.keys(parche)) {
  if (campo === 'premium') continue;
  const igual = JSON.stringify(proyeccion[campo]) === JSON.stringify(parche[campo]);
  console.log(`  ${igual ? '=' : '~'} ${campo}: ${resumir(proyeccion[campo])}  →  ${resumir(parche[campo])}`.slice(0, 400));
}

if (!APLICAR) {
  console.log('\nEnsayo: no se escribió nada. Repite con --aplicar para publicarlo.');
  process.exit(0);
}

/* ---------------------------------------------------------------- escribir */
const password = process.stdin.isTTY ? await preguntarOculto(`Contraseña de ${USUARIO} en ${URL_BASE}: `) : await leerLineaDeStdin();
if (!password) {
  console.error('✖ sin contraseña');
  process.exit(1);
}
const login = await pedir('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: USUARIO, password }) });
if (login.status !== 200 || !login.cuerpo?.token) {
  console.error(`✖ el login falló (status ${login.status}): ${JSON.stringify(login.cuerpo)}`);
  process.exit(1);
}
const token = login.cuerpo.token;

const guardado = await pedir(`/api/admin/vtubers/${hoy.id}`, { method: 'PATCH', token, body: JSON.stringify(parche) });
if (guardado.status !== 200) {
  console.error(`✖ el servidor rechazó el parche (status ${guardado.status}): ${JSON.stringify(guardado.cuerpo)}`);
  process.exit(1);
}
console.log('✔ parche aplicado');

/* Se comprueba el RESULTADO público, no la intención: la API pública va cacheada en el borde unos segundos. */
await new Promise((resolve) => setTimeout(resolve, 1500));
const despues = await pedir(`/api/vtubers/${encodeURIComponent(SLUG)}?verificar=${Date.now()}`);
const publico = despues.cuerpo ?? {};
const comprobaciones = [
  ['frase', parche.phrase === undefined || publico.phrase === parche.phrase],
  ['cumpleaños', parche.birthday === undefined || publico.birthday === parche.birthday],
  ['altura', parche.height === undefined || publico.height === parche.height],
  ['perfil', parche.profile === undefined || publico.profile?.length === parche.profile.length],
  ['redes', parche.socials === undefined || publico.socials?.length === parche.socials.length],
  ['facciones', parche.factions === undefined || publico.factions?.length === parche.factions.length],
];
for (const [nombre, ok] of comprobaciones) console.log(`${ok ? '✔' : '✖'} ${nombre}`);
if (comprobaciones.some(([, ok]) => !ok)) {
  console.log('(si algo sale ✖ espera ~30 s: la ficha pública se cachea en el borde y vuelve a comprobar con el ensayo)');
  process.exit(2);
}
