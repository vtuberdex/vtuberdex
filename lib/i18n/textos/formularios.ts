// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/** Textos de los formularios públicos (piezas compartidas, baja y verificación) en es / en / ja. Mismas claves en los tres. */
export const formulariosEs = {
  "form.confidencial": "confidencial · no se publica",
  "form.trampa": "No rellenar este campo",
  "form.terminosAcepto": "He leído y acepto los",
  "form.terminosNombre": "Términos y Condiciones",
  "form.terminosIncluida": ", incluida la",
  "form.terminosSalida": "cláusula de salida",
  "form.terminosSalidaNota":
    "(una ficha dada de baja no se elimina: se degrada).",

  "baja.titulo": "Darme de baja",
  "baja.intro":
    "Si ya no quieres figurar en el catálogo, escribe tu correo y el motivo. Te enviaremos un código de un solo uso para confirmar que la dirección es tuya; con él, la baja de la ficha inscrita con ese correo se aplica al instante.",
  "baja.errorTerminos":
    "Debes aceptar los términos y condiciones para solicitar la baja.",
  "baja.errorEnviar": "No se pudo enviar la solicitud. Inténtalo de nuevo.",
  "baja.errorConfirmar": "No se pudo confirmar. Inténtalo de nuevo.",
  "baja.revisaCorreo": "Revisa tu correo.",
  "baja.codigoEnviadoA": "Te enviamos un código a",
  "baja.codigoInstrucciones":
    "Pégalo aquí para confirmar la baja, o pulsa el botón del correo. Vale 24 horas; si no llega, mira en spam. Si ese correo no tiene ficha, te llegará un aviso en vez del código.",
  "baja.paso2": "Paso 2 de 2 · Confirmar la baja",
  "baja.codigo": "Código del correo",
  "baja.confirmando": "Confirmando…",
  "baja.confirmar": "Confirmar la baja",
  "baja.volver": "Volver y cambiar el correo",
  "baja.avisoTitulo": "Antes de continuar: qué pasa con tu ficha",
  "baja.avisoNoElimina": "Darte de baja",
  "baja.avisoNoEliminaFuerte": "no elimina tu ficha",
  "baja.avisoTexto":
    ". Permanece en el catálogo, pero sus datos se corrompen y se degradan de forma irreversible (textos, imágenes, enlaces). Tus datos personales (correo) sí se eliminan. Está en la",
  "baja.paso1": "Paso 1 de 2 · Tu correo y el motivo",
  "baja.correo": "Correo electrónico",
  "baja.correoAyuda":
    "El correo con el que inscribiste tu ficha. Te enviaremos un código para confirmar que es tuyo; con él se da de baja la ficha asociada.",
  "baja.motivo": "Motivo",
  "baja.motivoAyuda": "Opcional.",
  "baja.otroCorreo": "Mi ficha no se inscribió con este correo",
  "baja.ficha": "Ficha",
  "baja.fichaAyuda":
    "Su nombre o su dirección (por ejemplo /v/mi-nombre). Una persona la revisará, porque no podemos comprobar la titularidad solo con el correo.",
  "baja.enviando": "Enviando…",
  "baja.enviarCodigo": "Enviarme el código",

  "verificar.titulo": "Confirmar correo",
  "verificar.intro":
    "Pulsa el botón para confirmar que esta dirección es tuya. El enlace sirve una sola vez.",
  "verificar.tipo.inscripcion": "Tu inscripción",
  "verificar.tipo.baja": "Tu baja",
  "verificar.tipo.modificacion": "Tu solicitud de cambios",
  "verificar.bajaAplicada": "Baja aplicada.",
  "verificar.bajaTexto_one":
    "Confirmaste que el correo es tuyo: la ficha {fichas} pasó al grado 1 y tus datos de contacto se eliminaron.",
  "verificar.bajaTexto_other":
    "Confirmaste que el correo es tuyo: las fichas {fichas} pasaron al grado 1 y tus datos de contacto se eliminaron.",
  "verificar.confirmado": "Correo confirmado.",
  "verificar.sinFicha":
    "No encontramos ninguna ficha inscrita con esta dirección, así que no se aplicó nada. Tu solicitud quedó en espera: el mantenedor la revisará y podrá escribirte a este correo para saber qué ficha es.",
  "verificar.enEspera":
    "{tipo} quedó en espera de revisión del mantenedor. No hay plazo garantizado de respuesta.",
  "verificar.bajaRevision":
    "Como no pudimos comprobar la titularidad solo con el correo, la revisará una persona.",
  "verificar.volver": "Volver al catálogo",
  "verificar.errorConfirmar": "No se pudo confirmar. Inténtalo de nuevo.",
  "verificar.incompleto":
    "Este enlace está incompleto. Abre el enlace del correo tal cual llegó (si tu cliente lo cortó, cópialo entero) o vuelve a enviar el formulario.",
  "verificar.confirmando": "Confirmando…",
  "verificar.confirmarBoton": "Confirmar mi correo",
} as const;

/* Inglés y japonés viven en `formularios.en.ts` y `formularios.ja.ts`: se cargan solo si se eligen (ver `lib/i18n/mensajes.ts`). */
