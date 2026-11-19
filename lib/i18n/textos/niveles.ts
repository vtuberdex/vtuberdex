// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * Texto de la página «Cómo funcionan los niveles» (`/niveles`): experiencia, niveles, EXP total y puntos
 * de habilidad. es / en / ja con las mismas claves. Las CIFRAS no se escriben aquí: llegan como `{xp}`,
 * `{pts}`… desde `server/src/experiencia.mjs`, para que la explicación no pueda contradecir a la regla.
 */
export const nivelesEs = {
  "pie.niveles": "Cómo funcionan los niveles",
  "niveles.titulo": "Cómo funcionan los niveles",
  "niveles.intro":
    "Cada ficha tiene experiencia, nivel, habilidades y stats que se pueden mejorar. Esta página explica cómo funciona todo, paso a paso.",
  "niveles.s1.titulo": "1. La experiencia viene de los likes",
  "niveles.s1.texto":
    "Cualquier visitante puede darle un like a una ficha, uno por día. Cada like suma {xp} puntos de experiencia (EXP). No hay nada más que hacer: la experiencia crece sola con el cariño de la comunidad.",
  "niveles.s2.titulo": "2. Al llenar la barra, subes de nivel",
  "niveles.s2.texto":
    "La barra de experiencia se llena con los likes. Cuando llega al final, la ficha sube de nivel y la barra vuelve a empezar desde cero. Cada nivel pide un poco más que el anterior, así que subir se hace cada vez más lento: el primero pide {base} EXP y cada nivel siguiente pide {paso} más.",
  "niveles.tabla.titulo": "Cuánto pide cada nivel",
  "niveles.tabla.nivel": "Para subir al nivel",
  "niveles.tabla.exp": "EXP de la barra",
  "niveles.tabla.likes": "Likes aprox.",
  "niveles.s3.titulo": "3. La EXP total nunca se borra",
  "niveles.s3.texto":
    "Aunque la barra se vacíe al subir de nivel, la ficha guarda una cuenta de toda la experiencia que ha ganado en su vida: la «EXP total». Nunca baja ni se reinicia. La ves en la ficha, debajo de la barra.",
  "niveles.s4.titulo": "4. Cada nivel te regala puntos de habilidad",
  "niveles.s4.texto":
    "Cada vez que tu ficha sube de nivel gracias a los likes, ganas {pts} puntos de habilidad. Cada punto mejora una de tus habilidades en un rango, hasta el rango {max}. Los puntos no caducan: puedes guardarlos y gastarlos cuando quieras.",
  "niveles.s4.aviso":
    "Solo cuentan los niveles que ganas desde que tu ficha existe en VTuberDex; el nivel con que empezó no da puntos.",
  "niveles.sStats.titulo": "Puntos de stats",
  "niveles.sStats.texto":
    "Aparte de las habilidades, cada nivel ganado te da {ptsStats} puntos de stats. Sirven para subir HP, MP, Ataque, Ataque Mágico, Defensa y Defensa Mágica: cada punto suma una cantidad fija (HP +50, MP +25, el resto +5). Se reparten en «Mi ficha» y se ven en tu ficha pública.",
  "niveles.sStats.auto":
    "Velocidad, Evasión, Precisión y Crítico suben solos: +1 cada {cadaRapido} niveles ganados. La Suerte sube +1 cada {cadaSuerte} niveles, hasta un máximo de {topeSuerte}. La Evasión no pasa de 100. Estos no gastan puntos.",
  "niveles.sStats.aviso":
    "Los puntos de stats y los de habilidad son bolsas separadas: no se mezclan.",
  "niveles.s5.titulo": "5. Cómo repartir tus puntos",
  "niveles.s5.paso1":
    "Cuando tu ficha sube de nivel te llega un correo a la dirección con la que la inscribiste.",
  "niveles.s5.paso2":
    "Pulsa el botón del correo: entras a «Mi ficha» sin contraseña.",
  "niveles.s5.paso3":
    "Elige las habilidades y los stats que quieras mejorar y pulsa «Subir». El cambio se ve al instante en tu ficha pública.",
  "niveles.s5.nota":
    "El enlace del correo vale 7 días y puedes usarlo varias veces. Si caduca o lo perdiste, pide otro en «Mi ficha» con tu correo.",
  "niveles.s5.boton": "Ir a Mi ficha",
  "niveles.s6.titulo": "Preguntas frecuentes",
  "niveles.q1": "¿Puedo cambiar cómo repartí mis puntos?",
  "niveles.a1":
    "Sí. En «Mi ficha» los botones «Repartir de nuevo» (habilidades) y «Repartir stats de nuevo» te devuelven los puntos para que los repartas otra vez.",
  "niveles.q2": "¿Qué pasa si mi ficha no tiene correo?",
  "niveles.a2":
    "Las fichas que vienen del catálogo original no tienen un correo asociado, así que suben de nivel pero no reciben el aviso ni pueden repartir puntos. Las fichas inscritas por el formulario sí.",
  "niveles.q3": "¿Qué hago si no me llega el correo?",
  "niveles.a3":
    "Revisa la carpeta de spam. Si no está, entra a «Mi ficha» y pide el enlace de nuevo con el mismo correo de tu inscripción.",
  "niveles.q4": "¿Los rangos dan ventajas?",
  "niveles.a4":
    "Son un reconocimiento: se muestran como una insignia en cada habilidad de tu ficha pública.",
  "niveles.volver": "← Volver al catálogo",
  "niveles.ejemplo": "Ejemplo",
  "niveles.flujo.titulo": "El camino completo, en 4 pasos",
  "niveles.flujo.1.t": "Reciben likes",
  "niveles.flujo.1.d": "Cada visitante puede dar 1 like al día.",
  "niveles.flujo.2.t": "Suben de nivel",
  "niveles.flujo.2.d": "Al llenar la barra, la ficha pasa al siguiente nivel.",
  "niveles.flujo.3.t": "Te llega un correo",
  "niveles.flujo.3.d": "Con un botón para entrar sin contraseña.",
  "niveles.flujo.4.t": "Reparten sus puntos",
  "niveles.flujo.4.d": "Eligen qué habilidades y stats mejorar.",
  "niveles.g1.titulo": "La barra se vacía, el total sigue subiendo",
  "niveles.g1.texto":
    "Arriba, la barra de cada nivel: se llena y vuelve a cero al subir. Abajo, la EXP total: solo sube. Ambas salen de los mismos likes.",
  "niveles.g1.barra": "Barra del nivel",
  "niveles.g1.total": "EXP total",
  "niveles.g1.likes": "Likes recibidos",
  "niveles.g1.nivel": "Nivel {n}",
  "niveles.g2.titulo": "Cada nivel pide un poco más",
  "niveles.g2.texto":
    "Cada barra es la EXP que pide ese nivel para pasar al siguiente. Por eso los primeros niveles vuelan y los altos piden paciencia.",
  "niveles.g2.eje": "EXP que pide cada nivel",
  "niveles.m1.titulo": "Así se ve en tu ficha pública",
  "niveles.m1.texto":
    "Debajo del nombre verás tu nivel, la barra, la EXP total y, en cada habilidad que mejores, una insignia con su rango.",
  "niveles.m2.titulo": "Así se ve «Mi ficha»",
  "niveles.m2.texto":
    "El número grande son tus puntos disponibles. Cada habilidad tiene su botón «Subir»; los puntitos muestran su rango.",
  "niveles.m3.titulo": "Los rangos, de un vistazo",
  "niveles.m3.texto":
    "Cada punto llena un puntito. Con {max} puntitos la habilidad está en su rango máximo.",
  "niveles.ej.nombre": "Luna Nova",
  "niveles.ej.hab1": "Rayo Estelar",
  "niveles.ej.hab2": "Voz Dulce",
  "niveles.ej.hab3": "Gran Final",
};

/* Inglés y japonés viven en `niveles.en.ts` y `niveles.ja.ts`: se cargan solo si se eligen (ver `lib/i18n/mensajes.ts`). */
