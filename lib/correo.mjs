/**
 * Correo saliente: los enlaces de confirmación y de acceso al mantenedor.
 *
 * DÓNDE SE ENVÍA
 * --------------
 * Al Exim de la propia VPS (`127.0.0.1:25`, solo escucha en local): él firma con DKIM y entrega
 * directo al servidor de cada destinatario. La app no guarda credenciales de ningún proveedor. Sin
 * `VTUBERDEX_MAIL=smtp` el correo NO sale: el enlace se imprime en la consola del servidor, que es lo
 * que permite probar los flujos en local y en CI sin servidor de correo.
 *
 * EL ENLACE LLEVA EL TOKEN EN EL FRAGMENTO (`#`)
 * ----------------------------------------------
 * `https://…/verificar#t=<token>`. Un fragmento no viaja al servidor: ni nginx ni los logs de acceso
 * lo ven, ni se filtra en la cabecera `Referer`. Y la página pide pulsar un botón: muchos clientes y
 * antivirus abren los enlaces de los correos, y un GET que gastara el token lo quemaría antes de que
 * la persona llegue.
 *
 * LA URL SALE DE `SITE_URL`, no de la cabecera `Host` de la petición: con `Host` un atacante podría
 * pedir un enlace y que el correo apunte a un dominio suyo.
 */
import nodemailer from 'nodemailer';

import { DISENO } from './diseno.mjs';

const REMITENTE_POR_DEFECTO = 'VTuberDex <no-responder@vtuberdex.com>';

export function urlDelSitio(env = process.env) {
  return (env.SITE_URL?.trim() || 'http://localhost:3000').replace(/\/$/, '');
}

/** ¿Hay un servidor de correo real configurado? */
export function correoActivo(env = process.env) {
  return env.VTUBERDEX_MAIL === 'smtp';
}

let transporte = null;
function transporteSmtp(env = process.env) {
  transporte ??= nodemailer.createTransport({
    host: env.VTUBERDEX_SMTP_HOST || '127.0.0.1',
    port: Number(env.VTUBERDEX_SMTP_PORT || 25),
    // El Exim local no ofrece TLS en la interfaz de loopback y no hay nada que cifrar dentro de la máquina.
    secure: false,
    ignoreTLS: true,
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 15000,
  });
  return transporte;
}

/** Solo para los tests: sustituye el transporte (un objeto con `sendMail`). */
export function __usarTransporte(falso) {
  transporte = falso;
}

/**
 * Envía un correo. Lanza si el servidor no lo acepta; quien llama decide qué hacer con la solicitud.
 * @param {{ para: string, asunto: string, texto: string, html?: string }} mensaje
 */
export async function enviarCorreo({ para, asunto, texto, html }, env = process.env) {
  if (!correoActivo(env) && !transporte) {
    console.info(`[correo] (sin servidor) para=${para} asunto=${JSON.stringify(asunto)}\n${texto}`);
    return { simulado: true };
  }
  const info = await transporteSmtp(env).sendMail({
    from: env.VTUBERDEX_MAIL_FROM || REMITENTE_POR_DEFECTO,
    ...(env.VTUBERDEX_MAIL_REPLY_TO ? { replyTo: env.VTUBERDEX_MAIL_REPLY_TO } : {}),
    to: para,
    subject: asunto,
    text: texto,
    ...(html ? { html } : {}),
    // Mensajes automáticos: evita respuestas automáticas en cadena (vacaciones, soporte).
    headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' },
  });
  return { simulado: false, id: info.messageId };
}

const escapar = (valor) => String(valor).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Lo que escribe una persona viaja a un correo: se recorta y se limpia de saltos de línea. */
const dato = (valor, max = 80) => String(valor ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * La maqueta común de los correos, con el sistema de diseño de la web (`lib/diseno.mjs`,
 * `docs/sistema-de-diseno.md`): fondo `void`, tarjeta `panel` con borde `line`, texto `ink` y `muted`,
 * título en Knewave y botón del color de acento con texto `void`. Tablas en vez de flex/grid (no los
 * entienden todos los clientes), estilos en línea y `bgcolor` además de `background` (Outlook ignora
 * el segundo). Un correo oscuro propio puede verse invertido por clientes que fuerzan el modo claro:
 * por eso todo color va explícito y `color-scheme` declara que ya es oscuro. El texto plano lleva lo
 * mismo: hay clientes y filtros que solo muestran esa parte.
 *
 * `acento` es el NOMBRE de un token de color (`accent`, `violeta`, `peligro`, `aviso`, `exito`).
 *
 * @param {{ asunto: string, resumen: string, saludo: string, parrafos: string[], boton: string,
 *   enlace: string, datos?: Array<[string, string]>, aviso: string, vigencia: string, acento?: string }} c
 */
function plantilla({ asunto, resumen, saludo, parrafos, boton, enlace, datos = [], aviso, vigencia, acento = 'accent', codigo = '', codigoEn = 'la página de baja' }) {
  const { color: c, fuente: f, radio: r } = DISENO;
  const tono = c[acento] ?? c.accent;
  const texto = [
    asunto,
    '',
    saludo,
    '',
    ...parrafos.flatMap((p) => [p, '']),
    `${boton}: ${enlace}`,
    '',
    ...(codigo ? [`O pega este código en ${codigoEn}:`, codigo, ''] : []),
    ...(datos.length ? [...datos.map(([k, v]) => `${k}: ${v}`), ''] : []),
    vigencia,
    '',
    aviso,
    '',
    'Con cariño, el equipo de VTuberDex ✦ vtuberdex.com',
    'Este es un mensaje automático: no respondas a esta dirección.',
  ].join('\n');

  const p = (contenido) => `<p style="margin:0 0 14px;font-family:${f.texto};font-size:16px;line-height:1.6;color:${c.ink}">${escapar(contenido)}</p>`;
  const nota = (contenido) => `<p style="margin:0 0 10px;font-family:${f.texto};font-size:13px;line-height:1.55;color:${c.muted}">${escapar(contenido)}</p>`;
  const filas = datos
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 0;font-family:${f.texto};font-size:13px;color:${c.muted};width:38%;vertical-align:top">${escapar(k)}</td><td style="padding:6px 0;font-family:${f.texto};font-size:14px;color:${c.ink};font-weight:700;vertical-align:top">${escapar(v)}</td></tr>`,
    )
    .join('');
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${escapar(asunto)}</title>
<link rel="stylesheet" href="${DISENO.fuentesUrl}">
<style>:root{color-scheme:dark;supported-color-schemes:dark}body{background:${c.void}!important}</style></head>
<body bgcolor="${c.void}" style="margin:0;padding:0;background:${c.void};font-family:${f.texto};color:${c.ink}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapar(resumen)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${c.void}" style="background:${c.void}"><tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${c.panel}" style="max-width:560px;background:${c.panel};border-radius:${r.tarjeta}px;overflow:hidden;border:1px solid ${c.line}">
<tr><td bgcolor="${c.void}" style="background:${c.void};padding:22px 28px">
  <span style="font-family:${f.titulo};font-size:26px;font-weight:400;letter-spacing:.01em;color:${c.ink}">VTuber<span style="color:${c.accent}">Dex</span></span>
</td></tr>
<tr><td bgcolor="${tono}" style="height:3px;background:${tono};background-image:linear-gradient(90deg,${c.accent},${c.violeta});font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:30px 28px 8px">
  <p style="margin:0 0 10px;font-family:${f.texto};font-size:14px;letter-spacing:.5em;color:${c.muted}"><span style="color:${c.accent}">✦</span> <span style="color:${c.violeta}">✦</span> <span style="color:${c.accent}">✦</span></p>
  <h1 style="margin:0 0 16px;font-family:${f.titulo};font-size:24px;font-weight:400;line-height:1.3;color:${c.ink}">${escapar(asunto)}</h1>
  ${p(saludo)}
  ${parrafos.map(p).join('\n  ')}
</td></tr>
<tr><td align="center" style="padding:10px 28px 22px">
  <a href="${escapar(enlace)}" style="display:inline-block;background:${tono};color:${c.void};font-family:${f.texto};font-size:16px;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:${r.boton}px">${escapar(boton)}</a>
</td></tr>
${
  codigo
    ? `<tr><td style="padding:0 28px 18px"><p style="margin:0 0 6px;font-family:${f.texto};font-size:13px;color:${c.muted}">O pega este código en ${escapar(codigoEn)}:</p><p style="margin:0;padding:12px 14px;background:${c.void};border:1px dashed ${c.line};border-radius:${r.caja}px;font-family:${f.codigo};font-size:13px;color:${c.accent};word-break:break-all">${escapar(codigo)}</p></td></tr>`
    : ''
}
${
  filas
    ? `<tr><td style="padding:0 28px 18px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${c.panelSoft}" style="background:${c.panelSoft};border:1px solid ${c.line};border-radius:${r.caja}px"><tr><td style="padding:10px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${filas}</table></td></tr></table></td></tr>`
    : ''
}
<tr><td style="padding:0 28px 22px">
  ${nota(vigencia)}
  ${nota(aviso).replace('margin:0 0 10px', 'margin:0')}
</td></tr>
<tr><td bgcolor="${c.panelSoft}" style="padding:16px 28px;background:${c.panelSoft};border-top:1px solid ${c.line}">
  <p style="margin:0 0 6px;font-family:${f.texto};font-size:12px;line-height:1.5;color:${c.muted}">Si el botón no funciona, copia este enlace en tu navegador:</p>
  <p style="margin:0 0 12px;font-family:${f.texto};font-size:12px;line-height:1.5;color:${c.accent};word-break:break-all">${escapar(enlace)}</p>
  <p style="margin:0 0 4px;font-family:${f.texto};font-size:13px;color:${c.ink}">Con cariño, el equipo de VTuberDex <span style="color:${c.accent}">✦</span></p>
  <p style="margin:0;font-family:${f.texto};font-size:11px;color:${c.muted}">Mensaje automático de <a href="https://vtuberdex.com" style="color:${c.muted}">vtuberdex.com</a>. No respondas a esta dirección.</p>
</td></tr>
</table></td></tr></table></body></html>`;
  return { texto, html };
}

const AVISO_SOLICITUD = 'Si no fuiste tú, no pasa nada: ignora este correo y la solicitud se descarta sola.';
const VIGENCIA_SOLICITUD = 'El enlace es de un solo uso y vale 24 horas.';

/**
 * El correo que confirma una solicitud (inscripción, modificación o baja).
 * `nombre` es el nombre artístico (inscripción) o la ficha que escribió la persona (cambios y baja);
 * se recorta y se escapa, y nunca va en el asunto.
 */
export function correoDeSolicitud({ tipo, token, nombre = '' }, env = process.env) {
  // La inscripción y los cambios de ficha no se confirman con un botón: el enlace abre el formulario ya en el
  // paso del código. Solo la baja confirma en `/verificar`.
  const ruta = { inscripcion: '/inscripcion', modificacion: '/modificacion' }[tipo] ?? '/verificar';
  const enlace = `${urlDelSitio(env)}${ruta}#t=${token}`;
  const conFormulario = tipo === 'inscripcion' || tipo === 'modificacion';
  const quien = dato(nombre);
  const textos = {
    inscripcion: {
      asunto: 'Tu código para inscribirte en VTuberDex',
      resumen: '¡Qué bueno verte por aquí! Confirma tu correo y sigue con tu inscripción.',
      parrafos: [
        '¡Qué alegría que quieras sumarte a VTuberDex! Estás a un paso de crear tu ficha.',
        'Pulsa el botón (o pega el código en el formulario) para confirmar que este correo es tuyo y seguir con tu ficha. Tranquilo/a, no hay prisa: lo que escribas se guarda como borrador, y si lo dejas a medias puedes volver con este mismo correo y un código nuevo.',
        'Cuando la envíes, alguien del equipo la revisará con cariño y, si todo está bien, tu ficha se creará en borrador. No podemos prometer un plazo, pero la verá una persona de verdad.',
      ],
      boton: 'Seguir con mi ficha',
      datos: [['Solicitud', 'Inscripción']],
      acento: 'accent',
    },
    modificacion: {
      asunto: 'Tu código para actualizar tu ficha en VTuberDex',
      resumen: 'Confirma tu correo y cuéntanos qué quieres cambiar en tu ficha.',
      parrafos: [
        '¡Hola de nuevo! Vamos a ponerle al día tu ficha.',
        'Pulsa el botón (o pega el código en el formulario) para confirmar que este correo es tuyo y contarnos qué quieres cambiar. Solo rellena lo que cambia: lo que dejes en blanco se queda como está.',
        'Después alguien del equipo revisará tu solicitud y, si todo está bien, aplicará los cambios por ti.',
      ],
      boton: 'Actualizar mi ficha',
      datos: [['Solicitud', 'Actualizar una ficha']],
      acento: 'violeta',
    },
    baja: {
      asunto: 'Confirma tu baja de VTuberDex',
      resumen: 'Sentimos que te vayas. Antes de confirmar, lee con calma: la baja no se puede deshacer.',
      parrafos: [
        'Recibimos tu solicitud de baja y sentimos que quieras irte. Gracias por haber sido parte de VTuberDex.',
        'Antes de confirmar, un aviso con cariño: al confirmarla, la baja se aplica enseguida a la ficha inscrita con este correo. Pasa al grado 1 (degradada) y es irreversible, como explican los términos. Tus datos de contacto se eliminan.',
        'Si este correo no está asociado a ninguna ficha, tu solicitud queda en espera para que una persona del equipo la revise y te ayude.',
      ],
      boton: 'Confirmar la baja',
      datos: [['Solicitud', 'Baja'], ...(quien ? [['Ficha', quien]] : [])],
      acento: 'peligro',
    },
  }[tipo];
  if (!textos) throw new Error(`tipo de correo desconocido: ${tipo}`);
  const { texto, html } = plantilla({
    asunto: textos.asunto,
    resumen: textos.resumen,
    saludo: '¡Hola!',
    parrafos: textos.parrafos,
    boton: textos.boton,
    enlace,
    datos: textos.datos,
    aviso: conFormulario ? 'Si no fuiste tú, no pasa nada: ignora este correo. Sin el código nadie puede enviar nada con tu dirección.' : tipo === 'baja' ? 'Si no fuiste tú, quédate tranquilo/a: ignora este correo y no pasará nada mientras no pulses el botón. Y si cambias de idea, simplemente no lo confirmes.' : AVISO_SOLICITUD,
    vigencia: conFormulario ? 'El enlace y el código son de un solo uso y valen 1 hora.' : VIGENCIA_SOLICITUD,
    acento: textos.acento,
    codigo: token,
    codigoEn: { inscripcion: 'el formulario de inscripción', modificacion: 'el formulario de actualización' }[tipo] ?? 'la página de baja',
  });
  return { asunto: textos.asunto, texto, html };
}

/** El enlace mágico del mantenedor. */
export function correoDeAcceso({ token }, env = process.env) {
  const enlace = `${urlDelSitio(env)}/admin#entrar=${token}`;
  const asunto = 'Tu enlace para entrar al mantenedor de VTuberDex';
  const { texto, html } = plantilla({
    asunto,
    resumen: '¡Hola! Tu llave para entrar al mantenedor, sin contraseñas. Vale 15 minutos.',
    saludo: '¡Hola!',
    parrafos: ['¡Hola! Aquí tienes tu llave para entrar al mantenedor de VTuberDex y seguir cuidando la colección. Pulsa el botón y listo: no hace falta contraseña.'],
    boton: 'Entrar al mantenedor',
    enlace,
    datos: [['Acceso', 'Mantenedor de VTuberDex']],
    vigencia: 'El enlace es de un solo uso y vale 15 minutos. La sesión dura 8 horas.',
    aviso: 'Si no la pediste tú, ignora este correo. Y cuídala: no reenvíes el enlace, porque quien lo tenga puede entrar como tú hasta que se use o caduque.',
    acento: 'aviso',
  });
  return { asunto, texto, html };
}

/**
 * El enlace mágico de «Mi ficha». `motivo: 'nivel'` es el aviso de que la ficha subió de nivel (lleva los
 * puntos que tiene para repartir); `'enlace'` es el que se pide a mano desde la página. Vale 7 días y NO se
 * gasta al abrirlo: se puede volver a él para repartir los puntos en varias visitas.
 */
export function correoDeMiFicha({ token, nombre = '', nivel = 0, puntos = 0, motivo = 'enlace' }, env = process.env) {
  const enlace = `${urlDelSitio(env)}/mi-ficha#t=${token}`;
  const ficha = dato(nombre, 60) || 'tu ficha';
  const subio = motivo === 'nivel';
  const asunto = subio ? `¡${ficha} subió al nivel ${nivel}!` : 'Tu enlace para entrar a Mi ficha';
  const puntosTexto = `${puntos} ${puntos === 1 ? 'punto' : 'puntos'} de habilidad`;
  const { texto, html } = plantilla({
    asunto,
    resumen: subio ? `¡Felicidades! Tienes ${puntosTexto} para repartir. Pulsa para elegir en qué habilidades.` : 'Aquí tienes tu llave para entrar a tu ficha y repartir tus puntos de habilidad.',
    saludo: '¡Hola!',
    parrafos: subio
      ? [
          `¡Felicidades! Gracias a los likes de la comunidad, ${ficha} acaba de subir al nivel ${nivel}. Se nota que hay mucha gente que te quiere por aquí.`,
          `Eso te regala puntos de habilidad: ahora tienes ${puntosTexto} esperándote. Pulsa el botón, elige qué habilidades quieres mejorar y haz tu ficha todavía más tuya. No hace falta contraseña.`,
        ]
      : [`¡Hola! Aquí tienes tu llave para entrar a Mi ficha y repartir los puntos de habilidad de ${ficha}. Pulsa el botón: no hace falta contraseña.`],
    boton: 'Repartir mis puntos',
    enlace,
    datos: subio ? [['Ficha', ficha], ['Nivel', String(nivel)], ['Puntos para repartir', String(puntos)]] : [['Ficha', ficha]],
    vigencia: 'El enlace vale 7 días y puedes volver a usarlo cuantas veces quieras en ese tiempo. Si caduca, pide otro en vtuberdex.com/mi-ficha.',
    aviso: 'Cuida este correo: quien tenga el enlace puede repartir los puntos de tu ficha mientras no caduque, así que mejor no lo reenvíes.',
    acento: 'violeta',
  });
  return { asunto, texto, html };
}

/**
 * El correo de bienvenida que recibe quien queda asociado a una ficha (el mantenedor fijó o cambió su
 * correo). Es el único con maqueta propia: no pide nada, así que en vez de «acción + aviso» cuenta qué
 * es VTuberDex (un espacio que se construye entre todos) y qué puede hacer la persona ahora. Usa los
 * mismos tokens que la plantilla común; los resplandores son `rgba` de `accent` y `violeta` sobre un
 * `bgcolor` sólido, que es lo que ven los clientes que ignoran los degradados (Gmail, Outlook).
 *
 * No lleva ningún token ni acción sensible: solo enlaces PÚBLICOS (la ficha y «Mi ficha», que pide su
 * propio enlace por correo). `nombre` y `slug` los escribió una persona: se recortan y se escapan.
 */
export function correoDeBienvenida({ nombre = '', slug = '' }, env = process.env) {
  const { color: c, fuente: f, radio: r } = DISENO;
  const sitio = urlDelSitio(env);
  const ficha = dato(nombre, 60) || 'tu ficha';
  const enlace = `${sitio}/v/${encodeURIComponent(dato(slug, 80))}`;
  const enlaceMiFicha = `${sitio}/mi-ficha`;
  const asunto = `Bienvenido/a a VTuberDex, ${ficha}`;
  const intro = 'Este espacio lo vamos armando entre todos: cada ficha suma a la colección y cada persona que la visita le da vida.';
  const puntos = [
    ['Sube de nivel', 'Cada like de la comunidad le da experiencia a tu ficha. Cuando sube de nivel, te avisamos por aquí.'],
    ['Reparte tus puntos', 'Cada nivel te da puntos de habilidad. Entra a «Mi ficha», elige qué mejorar y hazla tuya. Sin contraseña: te mandamos un enlace.'],
    ['Crece en compañía', 'Estás en la misma colección que otros VTubers. Mira sus fichas, dales likes y verás que los tuyos también llegan.'],
  ];

  const texto = [
    asunto,
    '',
    '✦ ✧ ✦',
    '',
    `Este correo quedó asociado a la ficha de ${ficha}. ¡Bienvenido/a!`,
    '',
    intro,
    '',
    `Ver mi ficha: ${enlace}`,
    '',
    'Lo que puedes hacer desde ahora:',
    ...puntos.map(([t, d]) => `  ✦ ${t}: ${d}`),
    '',
    `Entrar a Mi ficha (te mandamos un enlace al correo): ${enlaceMiFicha}`,
    '',
    'Tu dirección se guarda de forma privada: no se muestra en la ficha ni en la web.',
    'Si crees que este correo no te corresponde, ignóralo o escríbenos para que lo quitemos de la ficha.',
    '',
    '— El equipo de VTuberDex · vtuberdex.com',
    'Este es un mensaje automático: no respondas a esta dirección.',
  ].join('\n');

  const brillo = (cerca) => `<span style="color:${cerca === 'a' ? c.accent : c.violeta}">✦</span>`;
  const filas = puntos
    .map(
      ([t, d], i) =>
        `<tr><td width="36" valign="top" style="padding:10px 0"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" bgcolor="${c.panelSoft}" style="width:28px;height:28px;border:1px solid ${c.line};border-radius:14px;font-family:${f.texto};font-size:14px;line-height:28px;color:${i % 2 ? c.violeta : c.accent}">✦</td></tr></table></td><td style="padding:10px 0 10px 8px"><p style="margin:0 0 3px;font-family:${f.texto};font-size:16px;font-weight:700;color:${c.ink}">${escapar(t)}</p><p style="margin:0;font-family:${f.texto};font-size:14px;line-height:1.55;color:${c.muted}">${escapar(d)}</p></td></tr>`,
    )
    .join('');
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${escapar(asunto)}</title>
<link rel="stylesheet" href="${DISENO.fuentesUrl}">
<style>:root{color-scheme:dark;supported-color-schemes:dark}body{background:${c.void}!important}</style></head>
<body bgcolor="${c.void}" style="margin:0;padding:0;background:${c.void};font-family:${f.texto};color:${c.ink}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapar(`${ficha} ya forma parte de VTuberDex. Pasa y mira lo que puedes hacer.`)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${c.void}" style="background:${c.void}"><tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${c.panel}" style="max-width:580px;background:${c.panel};border-radius:${r.tarjeta + 4}px;overflow:hidden;border:1px solid ${c.line}">
<tr><td align="center" bgcolor="${c.void}" style="background:${c.void};background-image:radial-gradient(circle at 18% 0%,rgba(94,234,212,.22),rgba(5,6,10,0) 55%),radial-gradient(circle at 85% 20%,rgba(168,85,247,.22),rgba(5,6,10,0) 55%);padding:34px 28px 28px">
  <p style="margin:0 0 14px;font-family:${f.texto};font-size:16px;letter-spacing:.5em;color:${c.muted}">${brillo('a')} ${brillo('v')} ${brillo('a')}</p>
  <span style="font-family:${f.titulo};font-size:30px;font-weight:400;color:${c.ink}">VTuber<span style="color:${c.accent}">Dex</span></span>
  <p style="margin:8px 0 0;font-family:${f.texto};font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:${c.muted}">Un espacio de VTubers, hecho entre todos</p>
</td></tr>
<tr><td bgcolor="${c.accent}" style="height:3px;background:${c.accent};background-image:linear-gradient(90deg,${c.accent},${c.violeta});font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td align="center" style="padding:34px 28px 6px">
  <h1 style="margin:0 0 14px;font-family:${f.titulo};font-size:28px;font-weight:400;line-height:1.25;color:${c.ink}">¡Bienvenido/a!</h1>
  <p style="margin:0 0 22px;font-family:${f.texto};font-size:16px;line-height:1.65;color:${c.ink}">${escapar(intro)}</p>
</td></tr>
<tr><td style="padding:0 28px 8px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${c.accent}" style="background:${c.accent};background-image:linear-gradient(135deg,${c.accent},${c.violeta});border-radius:${r.tarjeta}px"><tr><td style="padding:2px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${c.panelSoft}" style="background:${c.panelSoft};border-radius:${r.tarjeta - 2}px"><tr><td align="center" style="padding:24px 18px">
      <p style="margin:0 0 8px;font-family:${f.texto};font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:${c.muted}">Tu ficha en la colección</p>
      <p style="margin:0 0 8px;font-family:${f.titulo};font-size:26px;line-height:1.25;color:${c.accent}">${escapar(ficha)}</p>
      <p style="margin:0;font-family:${f.texto};font-size:14px;line-height:1.55;color:${c.muted}">Este correo ahora la acompaña: por aquí te avisamos de lo que le pase.</p>
    </td></tr></table>
  </td></tr></table>
</td></tr>
<tr><td align="center" style="padding:22px 28px 8px">
  <a href="${escapar(enlace)}" style="display:inline-block;background:${c.accent};color:${c.void};font-family:${f.texto};font-size:16px;font-weight:700;text-decoration:none;padding:14px 30px;border-radius:${r.boton}px">Ver mi ficha</a>
</td></tr>
<tr><td style="padding:26px 28px 6px">
  <p style="margin:0 0 4px;font-family:${f.titulo};font-size:19px;color:${c.ink}">Lo que puedes hacer desde ahora</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${filas}</table>
</td></tr>
<tr><td align="center" style="padding:14px 28px 26px">
  <a href="${escapar(enlaceMiFicha)}" style="display:inline-block;color:${c.violeta};font-family:${f.texto};font-size:15px;font-weight:700;text-decoration:none;padding:12px 24px;border:1px solid ${c.violeta};border-radius:${r.boton}px">Entrar a Mi ficha</a>
  <p style="margin:10px 0 0;font-family:${f.texto};font-size:12px;color:${c.muted}">Te mandamos un enlace a este correo. No hace falta contraseña.</p>
</td></tr>
<tr><td bgcolor="${c.panelSoft}" style="padding:20px 28px;background:${c.panelSoft};border-top:1px solid ${c.line}">
  <p style="margin:0 0 8px;font-family:${f.texto};font-size:13px;line-height:1.55;color:${c.muted}">Tu dirección se guarda de forma privada: no se muestra en la ficha ni en la web. Si crees que este correo no te corresponde, ignóralo o escríbenos para que lo quitemos de la ficha.</p>
  <p style="margin:0 0 6px;font-family:${f.texto};font-size:12px;line-height:1.5;color:${c.muted}">Si el botón no funciona, copia este enlace en tu navegador:</p>
  <p style="margin:0 0 12px;font-family:${f.texto};font-size:12px;line-height:1.5;color:${c.accent};word-break:break-all">${escapar(enlace)}</p>
  <p style="margin:0;font-family:${f.texto};font-size:11px;color:${c.muted}">El equipo de <a href="https://vtuberdex.com" style="color:${c.muted}">VTuberDex</a> · Mensaje automático: no respondas a esta dirección.</p>
</td></tr>
</table></td></tr></table></body></html>`;
  return { asunto, texto, html };
}
