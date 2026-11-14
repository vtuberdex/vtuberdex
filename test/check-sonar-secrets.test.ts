/**
 * Prueba de la guarda de secretos del job `sonar`
 * (scripts/check-sonar-secrets.sh).
 *
 * Ejecuta el MISMO bloque de shell que corre el workflow, no una copia: si la
 * guarda cambia, esta prueba cambia con ella. Los casos son los tres que
 * importan de verdad:
 *
 *  - run del propio repositorio sin secretos  -> falla (exit 1) con mensaje.
 *  - PR desde un fork sin secretos            -> aviso y skip (exit 0).
 *  - run con los secretos puestos             -> escaneo (exit 0, skip=false).
 *
 * Además se comprueba sobre el YAML cargado (no con grep del texto) que los
 * pasos de escaneo y de quality gate dependen del output `skip` de la guarda,
 * de modo que el único skip posible es el de un fork sin secretos.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const RAIZ = path.resolve(import.meta.dirname, "..");
const GUARDA = path.join(RAIZ, "scripts", "check-sonar-secrets.sh");
const WORKFLOW = path.join(RAIZ, ".github", "workflows", "sonar.yml");

let salidaTemporal: string | null = null;

afterEach(() => {
  if (salidaTemporal) {
    rmSync(salidaTemporal, { recursive: true, force: true });
  }
  salidaTemporal = null;
});

function ejecutarGuarda(entorno: Record<string, string>) {
  const carpeta = mkdtempSync(path.join(tmpdir(), "guarda-sonar-"));
  salidaTemporal = carpeta;
  const ficheroSalida = path.join(carpeta, "output");

  // `spawnSync` pide un `NodeJS.ProcessEnv` completo (aquí NODE_ENV es
  // obligatorio), así que se parte de `process.env` y se fijan de forma
  // explícita TODAS las variables que lee la guarda: los secretos arrancan
  // vacíos para que el entorno del desarrollador no decida el resultado de los
  // casos "sin secretos", y el caso de prueba los sobrescribe si los aporta.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    GITHUB_OUTPUT: ficheroSalida,
    GITHUB_REPOSITORY: "vtuberdex/vtuberdex",
    GITHUB_EVENT_NAME: "",
    GITHUB_HEAD_REPO: "",
    SONAR_TOKEN: "",
    SONAR_HOST_URL: "",
    ...entorno,
  };

  const resultado = spawnSync("bash", [GUARDA], {
    cwd: RAIZ,
    encoding: "utf8",
    env,
  });

  let output = "";
  try {
    output = readFileSync(ficheroSalida, "utf8");
  } catch {
    output = "";
  }

  return {
    status: resultado.status,
    stdout: resultado.stdout ?? "",
    stderr: resultado.stderr ?? "",
    output,
  };
}

/** Extrae el valor de `skip=` del fichero $GITHUB_OUTPUT. */
function skipPublicado(output: string): string | null {
  const coincidencia = /^skip=(.*)$/m.exec(output);
  return coincidencia ? coincidencia[1].trim() : null;
}

describe("guarda de secretos de Sonar", () => {
  it("falla en un run del propio repositorio sin SONAR_TOKEN ni SONAR_HOST_URL", () => {
    const { status, stdout, stderr, output } = ejecutarGuarda({
      GITHUB_EVENT_NAME: "push",
      GITHUB_HEAD_REPO: "",
    });

    expect(status).toBe(1);
    const texto = stdout + stderr;
    expect(texto).toContain("::error::");
    expect(texto).toContain("SONAR_TOKEN");
    expect(texto).toContain("SONAR_HOST_URL");
    expect(texto).not.toContain("::warning::");
    // No se publica skip: si el paso falla, el escaneo no debe quedar omitido en silencio.
    expect(skipPublicado(output)).toBeNull();
  });

  it("falla en un PR del mismo repositorio (incluidos los de Dependabot) sin secretos", () => {
    const { status, stdout, stderr } = ejecutarGuarda({
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_HEAD_REPO: "vtuberdex/vtuberdex",
    });

    expect(status).toBe(1);
    expect(stdout + stderr).toContain("::error::");
  });

  it("avisa y omite el escaneo en un PR desde un fork sin secretos", () => {
    const { status, stdout, stderr, output } = ejecutarGuarda({
      GITHUB_EVENT_NAME: "pull_request",
      GITHUB_HEAD_REPO: "alguien/vtuberdex",
    });

    expect(status).toBe(0);
    expect(stdout + stderr).toContain("::warning::");
    expect(stdout + stderr).not.toContain("::error::");
    expect(skipPublicado(output)).toBe("true");
  });

  it("ejecuta el escaneo cuando los secretos están presentes", () => {
    const { status, output } = ejecutarGuarda({
      GITHUB_EVENT_NAME: "push",
      GITHUB_HEAD_REPO: "",
      SONAR_TOKEN: "token-de-prueba",
      SONAR_HOST_URL: "https://sonar.example.test",
    });

    expect(status).toBe(0);
    expect(skipPublicado(output)).toBe("false");
  });
});

describe("workflow de Sonar", () => {
  /**
   * Parser mínimo de bloques de step: usa la estructura real del YAML (indentación)
   * en vez de grep, para poder afirmar qué pasos dependen del output de la guarda.
   */
  function pasosDelJobSonar(yaml: string): { nombre: string; condicion: string | null; run: string | null }[] {
    const lineas = yaml.split("\n");
    const inicioJob = lineas.findIndex((l) => /^\s{2}sonar:\s*$/.test(l));
    expect(inicioJob).toBeGreaterThan(-1);

    let fin = lineas.length;
    for (let i = inicioJob + 1; i < lineas.length; i += 1) {
      if (/^\s{2}\S/.test(lineas[i])) {
        fin = i;
        break;
      }
    }

    const bloque = lineas.slice(inicioJob, fin);
    const pasos: { nombre: string; condicion: string | null; run: string | null }[] = [];
    let actual: { nombre: string; condicion: string | null; run: string | null } | null = null;

    for (const linea of bloque) {
      const item = /^\s{6}- (.*)$/.exec(linea);
      if (item) {
        actual = { nombre: item[1].replace(/^name:\s*/, "").trim(), condicion: null, run: null };
        pasos.push(actual);
        continue;
      }
      if (!actual) {
        continue;
      }
      const condicion = /^\s{8}if:\s*(.+)$/.exec(linea);
      if (condicion) {
        actual.condicion = condicion[1].trim();
      }
      const nombre = /^\s{8}name:\s*(.+)$/.exec(linea);
      if (nombre) {
        actual.nombre = nombre[1].trim();
      }
      const run = /^\s{8}run:\s*(.+)$/.exec(linea);
      if (run) {
        actual.run = run[1].trim();
      }
    }

    return pasos;
  }

  it("tiene la guarda antes del escaneo y ambos pasos dependen de su output", () => {
    const yaml = readFileSync(WORKFLOW, "utf8");
    const pasos = pasosDelJobSonar(yaml);

    const guarda = pasos.findIndex((p) => p.run === "bash scripts/check-sonar-secrets.sh");
    expect(guarda).toBeGreaterThan(-1);

    const escaneo = pasos.findIndex((p) => p.nombre.includes("sonarqube-scan-action"));
    const gate = pasos.findIndex((p) => p.nombre.includes("sonarqube-quality-gate-action"));
    expect(escaneo).toBeGreaterThan(guarda);
    expect(gate).toBeGreaterThan(guarda);

    // El único skip posible es el que publica la guarda (fork sin secretos).
    expect(pasos[escaneo].condicion).toBe("steps.guarda-sonar.outputs.skip != 'true'");
    expect(pasos[gate].condicion).toBe("steps.guarda-sonar.outputs.skip != 'true'");
  });
});
