// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * Dónde guarda la web su estado de servicio (auditoría y sesiones revocadas del panel de Minecraft).
 *
 * Ruta FIJA, no del entorno ni de la petición: escribir en disco a partir de un dato de fuera es lo que
 * Sonar y CodeQL marcan. En producción es `/var/lib/vtuberdex`, la única carpeta que el servicio puede
 * escribir (`ReadWritePaths`); la web corre desde el release, donde `data/` no existe (ver la auditoría
 * de `minecraft-consola.mjs`). En local y en las pruebas, `data/` del directorio de trabajo.
 *
 * Módulo aparte y sin dependencias: lo importan `minecraft-consola.mjs` y `minecraft-admin.mjs`, que se
 * importan entre sí, y una constante que se lee al cargar no puede vivir en ese ciclo.
 */
import fs from "node:fs";
import path from "node:path";

export const DIRECTORIO_DE_ESTADO =
  process.env.NODE_ENV === "production" && fs.existsSync("/var/lib/vtuberdex")
    ? "/var/lib/vtuberdex"
    : path.join(process.cwd(), "data");
