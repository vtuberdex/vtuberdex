// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * Texto de la página «Cómo entrar al servidor de Minecraft» (`/minecraft`). es / en / ja con las mismas
 * claves. El flujo que describe es el del plugin (`minecraft/`, `server/src/minecraft.mjs`): la web es la
 * fuente de la verdad y el servidor solo deja jugar a quien tiene una ficha vinculada.
 */
export const minecraftEs = {
  'pie.minecraft': 'Servidor de Minecraft',
  'mc.titulo': 'Cómo entrar al servidor de Minecraft',
  'mc.intro':
    'El servidor de VTuberDex es solo para VTubers con ficha: juegas con los stats de tu propia carta y lo que ganas suma experiencia en la web. Esta guía te lleva de cero a jugar.',
  'mc.req.titulo': 'Antes de empezar',
  'mc.req.1': 'Tener tu ficha inscrita y aprobada. Si aún no la tienes, empieza por la inscripción.',
  'mc.req.2': 'Acordarte del correo con el que la inscribiste: es la llave para vincular tu cuenta.',
  'mc.req.3': 'Minecraft Java o Bedrock (Android, iOS, Windows de la tienda). Las consolas no pueden añadir servidores propios.',
  'mc.req.boton': 'Inscribir mi ficha',
  'mc.dir.titulo': 'Dirección del servidor',
  'mc.dir.java': 'Java',
  'mc.dir.javaTexto': 'Dirección: {host} (puerto {puertoJava}, el de siempre).',
  'mc.dir.bedrock': 'Bedrock',
  'mc.dir.bedrockTexto': 'Dirección: {host} · Puerto: {puertoBedrock}. Entras con tu cuenta Xbox, sin comprar Java; tu nombre aparece con un punto delante.',
  'mc.dir.copiar': 'Copiar dirección',
  'mc.dir.copiado': 'Copiada ✓',
  'mc.pasos.titulo': 'Paso a paso',
  'mc.p1.t': 'Entra al servidor',
  'mc.p1.d': 'Añade el servidor con la dirección de arriba y conéctate. Aparecerás en una casita: es la sala de espera. Desde ahí solo puedes usar comandos.',
  'mc.p2.t': 'Pide tu código',
  'mc.p2.d': 'Escribe en el chat el comando con el correo de tu inscripción:',
  'mc.p2.cmd': '/vtd email tu@correo.com',
  'mc.p2.nota': 'Te llega un código al correo (vale 10 minutos). Si tu correo tiene varias fichas, llega un código por cada una. Mira también la carpeta de spam.',
  'mc.p3.t': 'Escribe el código',
  'mc.p3.d': 'Copia el código del correo y pégalo en el juego. Hay que ESCRIBIRLO aquí: no basta con pulsar un enlace.',
  'mc.p3.cmd': '/vtd codigo TU-CODIGO',
  'mc.p3.nota': '¿Prefieres no usar el correo del juego? En «Mi ficha» también puedes generar el código.',
  'mc.p4.t': '¡A jugar!',
  'mc.p4.d': 'La puerta se abre, sales de la casa y tus stats de la ficha quedan aplicados. Verás tu nivel y tu barra de EXP arriba y un panel con tu progreso a un lado.',
  'mc.cmd.titulo': 'Comandos útiles',
  'mc.cmd.ficha': '/vtd ficha — tus stats en el chat.',
  'mc.cmd.panel': '/vtd panel — muestra u oculta el panel lateral.',
  'mc.cmd.stats': '/vtd stats — repartir tus puntos.',
  'mc.cmd.desvincular': '/vtd desvincular — suelta tu cuenta de la ficha.',
  'mc.reglas.titulo': 'Cosas que conviene saber',
  'mc.reglas.1': 'Una ficha, una conexión a la vez: si ya juega alguien desde otra red con tu ficha, el servidor rechaza la segunda conexión.',
  'mc.reglas.2': 'Si entras con Java sin cuenta premium, el servidor te pide confirmar el correo de nuevo cada 7 días o cuando cambies de red. Es lo que protege tu ficha de que otra persona use tu nombre.',
  'mc.reglas.3': 'Jugar suma experiencia a tu ficha, con un tope diario. Los niveles y puntos funcionan igual que con los likes.',
  'mc.reglas.4': 'Si no vinculas tu cuenta en unos minutos, el servidor te expulsa de la sala de espera. Puedes volver a entrar cuando quieras.',
  'mc.faq.titulo': 'Si algo no funciona',
  'mc.faq.q1': 'No me llega el código',
  'mc.faq.a1': 'Revisa spam. Solo se puede pedir uno por minuto. El correo tiene que ser exactamente el de tu inscripción aprobada.',
  'mc.faq.q2': 'Dice que el código no sirve',
  'mc.faq.a2': 'Cada código se usa una vez y caduca a los 10 minutos. Pide uno nuevo con /vtd email.',
  'mc.faq.q3': 'Mi ficha no es de una inscripción',
  'mc.faq.a3': 'Las fichas del catálogo original no tienen correo guardado. Escríbenos desde la página de modificación para asociarlo.',
  'mc.volver': '← Volver al catálogo',
} as const;

/* Inglés y japonés viven en `minecraft.en.ts` y `minecraft.ja.ts`: se cargan solo si se eligen (ver `lib/i18n/mensajes.ts`). */
