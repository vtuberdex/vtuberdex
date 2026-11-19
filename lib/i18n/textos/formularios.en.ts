// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
import type { formulariosEs } from "./formularios";

export const formulariosEn: { [K in keyof typeof formulariosEs]: string } = {
  "form.confidencial": "confidential · not published",
  "form.trampa": "Do not fill in this field",
  "form.terminosAcepto": "I have read and accept the",
  "form.terminosNombre": "Terms and Conditions",
  "form.terminosIncluida": ", including the",
  "form.terminosSalida": "exit clause",
  "form.terminosSalidaNota":
    "(a card that is removed is not deleted: it is degraded).",

  "baja.titulo": "Remove me",
  "baja.intro":
    "If you no longer want to appear in the catalog, enter your email and the reason. We will send you a one-time code to confirm the address is yours; with it, the card registered with that email is removed right away.",
  "baja.errorTerminos":
    "You must accept the terms and conditions to request removal.",
  "baja.errorEnviar": "The request could not be sent. Please try again.",
  "baja.errorConfirmar": "Could not confirm. Please try again.",
  "baja.revisaCorreo": "Check your email.",
  "baja.codigoEnviadoA": "We sent a code to",
  "baja.codigoInstrucciones":
    "Paste it here to confirm the removal, or press the button in the email. It is valid for 24 hours; if it does not arrive, check your spam folder.",
  "baja.paso2": "Step 2 of 2 · Confirm the removal",
  "baja.codigo": "Code from the email",
  "baja.confirmando": "Confirming…",
  "baja.confirmar": "Confirm the removal",
  "baja.volver": "Go back and change the email",
  "baja.avisoTitulo": "Before you continue: what happens to your card",
  "baja.avisoNoElimina": "Removing yourself",
  "baja.avisoNoEliminaFuerte": "does not delete your card",
  "baja.avisoTexto":
    ". It stays in the catalog, but its data is corrupted and irreversibly degraded (texts, images, links). Your personal data (email) is deleted. It is covered by the",
  "baja.paso1": "Step 1 of 2 · Your email and the reason",
  "baja.correo": "Email address",
  "baja.correoAyuda":
    "The email you used to register your card. We will send you a code to confirm it is yours; with it, the associated card is removed.",
  "baja.motivo": "Reason",
  "baja.motivoAyuda": "Optional.",
  "baja.otroCorreo": "My card was not registered with this email",
  "baja.ficha": "Card",
  "baja.fichaAyuda":
    "Its name or its address (for example /v/my-name). A person will review it, because we cannot verify ownership from the email alone.",
  "baja.enviando": "Sending…",
  "baja.enviarCodigo": "Send me the code",

  "verificar.titulo": "Confirm email",
  "verificar.intro":
    "Press the button to confirm that this address is yours. The link works only once.",
  "verificar.tipo.inscripcion": "Your registration",
  "verificar.tipo.baja": "Your removal request",
  "verificar.tipo.modificacion": "Your change request",
  "verificar.bajaAplicada": "Removal applied.",
  "verificar.bajaTexto_one":
    "You confirmed the email is yours: the card {fichas} was moved to grade 1 and your contact data was deleted.",
  "verificar.bajaTexto_other":
    "You confirmed the email is yours: the cards {fichas} were moved to grade 1 and your contact data was deleted.",
  "verificar.confirmado": "Email confirmed.",
  "verificar.sinFicha":
    "We found no card registered with this address, so nothing was applied. Your request is on hold: the maintainer will review it and may write to this email to find out which card it is.",
  "verificar.enEspera":
    "{tipo} is waiting for the maintainer to review it. There is no guaranteed response time.",
  "verificar.bajaRevision":
    "Since we could not verify ownership from the email alone, a person will review it.",
  "verificar.volver": "Back to the catalog",
  "verificar.errorConfirmar": "Could not confirm. Please try again.",
  "verificar.incompleto":
    "This link is incomplete. Open the link from the email exactly as it arrived (if your client cut it, copy it in full) or submit the form again.",
  "verificar.confirmando": "Confirming…",
  "verificar.confirmarBoton": "Confirm my email",
};
