/**
 * Escribe los cuatro correos (inscripción, cambios, baja y acceso) como archivos `.html` y `.txt`
 * para revisarlos en un navegador sin enviar nada. Uso: `npm run correos:vista [carpeta]`.
 */
import fs from 'node:fs';
import path from 'node:path';

import { correoDeAcceso, correoDeSolicitud } from '../lib/correo.mjs';

const destino = path.resolve(process.argv[2] ?? 'data/vista-correos');
fs.mkdirSync(destino, { recursive: true });
const token = 'Tg3xYq0pV8mK2wLzR9aBcDeFgHiJkLmNoPqRsTuVwXy';
const entorno = { SITE_URL: 'https://vtuberdex.com' };

const correos = {
  inscripcion: correoDeSolicitud({ tipo: 'inscripcion', token, nombre: 'Luna Test' }, entorno),
  modificacion: correoDeSolicitud({ tipo: 'modificacion', token, nombre: '#018 GKuro' }, entorno),
  baja: correoDeSolicitud({ tipo: 'baja', token, nombre: '/v/gkuro' }, entorno),
  acceso: correoDeAcceso({ token }, entorno),
};
for (const [nombre, { asunto, texto, html }] of Object.entries(correos)) {
  fs.writeFileSync(path.join(destino, `${nombre}.html`), html);
  fs.writeFileSync(path.join(destino, `${nombre}.txt`), `Asunto: ${asunto}\n\n${texto}\n`);
}
console.log(`correos escritos en ${destino}`);
