import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const script = path.resolve(import.meta.dirname, "../../scripts/auto-deploy.sh");
const fuente = readFileSync(script, "utf8");
const ini = fuente.indexOf("esperar_salud() {");
const fin = ini < 0 ? -1 : fuente.indexOf("\n}\n", ini) + 2;
const funcion = ini < 0 ? "" : fuente.slice(ini, fin);

// Ejecuta esperar_salud con un curl simulado. curlScript decide el resultado; n es el numero de llamadas hechas hasta ahora.
function correr(curlScript) {
  const dir = mkdtempSync(path.join(process.env.TMPDIR ?? tmpdir(), "salud-"));
  const registro = path.join(dir, "llamadas");
  writeFileSync(
    path.join(dir, "curl"),
    ["#!/usr/bin/env bash", `echo x >> "${registro}"; n=$(wc -l < "${registro}" | tr -d ' '); ${curlScript}`, ""].join("\n"),
  );
  chmodSync(path.join(dir, "curl"), 0o755);
  const r = spawnSync("bash", ["-c", `${funcion}; esperar_salud http://fake/health`], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, SALUD_PAUSA: "0", SALUD_INTENTOS: "6" },
    encoding: "utf8",
  });
  const intentos = existsSync(registro) ? readFileSync(registro, "utf8").trim().split("\n").length : 0;
  return { code: r.status, intentos };
}

test("esperar_salud da el despliegue por bueno si el curl falla una vez y luego responde", () => {
  assert.ok(funcion, "esperar_salud no esta en scripts/auto-deploy.sh");
  const r = correr('[ "$n" -ge 2 ] && exit 0; exit 28');
  assert.equal(r.code, 0);
  assert.equal(r.intentos, 2);
});

test("esperar_salud da el despliegue por fallido tras agotar los intentos", () => {
  assert.ok(funcion, "esperar_salud no esta en scripts/auto-deploy.sh");
  const r = correr("exit 28");
  assert.notEqual(r.code, 0);
  assert.equal(r.intentos, 6);
});
