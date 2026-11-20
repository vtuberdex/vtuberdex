// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * Copia el build AMD de Monaco (`node_modules/monaco-editor/min/vs`) a `public/monaco/vs`.
 *
 * El editor de la pestaña «Archivos» de `/minecraft-admin` es Monaco (el de VS Code). Por defecto
 * `@monaco-editor/react` lo baja de jsDelivr; aquí se sirve desde el propio sitio: el panel guarda
 * una sesión con acceso a la terminal del servidor y no debe ejecutar código de un CDN ajeno.
 * Se ejecuta antes de `next dev` y `next build`; `public/monaco/` está en .gitignore.
 */
import fs from "node:fs";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");
const origen = path.join(raiz, "node_modules/monaco-editor/min/vs");
const destino = path.join(raiz, "public/monaco/vs");
const version = JSON.parse(
  fs.readFileSync(path.join(raiz, "node_modules/monaco-editor/package.json"), "utf8"),
).version;
const marca = path.join(destino, ".version");

if (fs.existsSync(marca) && fs.readFileSync(marca, "utf8") === version) {
  process.exit(0);
}
fs.rmSync(destino, { recursive: true, force: true });
fs.cpSync(origen, destino, { recursive: true });
fs.writeFileSync(marca, version);
console.log(`monaco-editor ${version} copiado a public/monaco/vs`);
