/**
 * Quita de un SARIF los hallazgos que `sonar-project.properties` ya declara revisados
 * (`sonar.issue.ignore.multicriteria.*`: regla + archivo).
 *
 * Por qué existe: Sonar NO aplica esas exclusiones a los issues que importa de un SARIF
 * (`sonar.sarifReportPaths`). Medido en el análisis del PR #85 (2026-11-13): con `e1` declarada
 * para `scraper/src/safe-write.mjs`, el escáner importó igual «1 vulnerabilities in total» y el
 * `security_rating` quedó en C, con el quality gate en rojo para todo PR. Cambiar el código no
 * lo cierra: `js/http-to-file-access` marca que se escribe a disco CONTENIDO descargado, que es el
 * propósito del scraper, no la ruta. Filtrar aquí deja una sola lista (la de las propiedades) y
 * el mismo efecto que tendría la exclusión si Sonar la respetara: misma regla, mismo archivo.
 */

/** Lee las parejas regla/archivo de `sonar.issue.ignore.multicriteria`. */
export function exclusionesDeSonar(texto) {
  const valores = new Map();
  for (const linea of texto.split(/\r?\n/)) {
    const m = /^\s*sonar\.issue\.ignore\.multicriteria\.([^.=\s]+)\.(ruleKey|resourceKey)\s*=\s*(.*?)\s*$/.exec(linea);
    if (!m) {
      continue;
    }
    const [, id, campo, valor] = m;
    const actual = valores.get(id) ?? {};
    actual[campo] = valor;
    valores.set(id, actual);
  }
  return [...valores.values()].filter((e) => e.ruleKey && e.resourceKey);
}

/** Ruta del primer `artifactLocation` del resultado, relativa a la raíz y sin `./` ni `file://`. */
function archivoDelResultado(resultado) {
  const uri = resultado.locations?.[0]?.physicalLocation?.artifactLocation?.uri ?? '';
  return decodeURIComponent(uri.replace(/^file:\/\//, '')).replace(/^\.\//, '');
}

/**
 * Devuelve una copia del SARIF sin los resultados excluidos y cuántos quitó.
 * La clave de regla es la que Sonar le da al issue externo: `external_<herramienta>:<regla>`.
 */
export function filtrarSarif(sarif, exclusiones) {
  let quitados = 0;
  const runs = (sarif.runs ?? []).map((run) => {
    const herramienta = run.tool?.driver?.name ?? '';
    const results = (run.results ?? []).filter((resultado) => {
      const regla = `external_${herramienta}:${resultado.ruleId}`;
      const archivo = archivoDelResultado(resultado);
      const excluido = exclusiones.some((e) => e.ruleKey === regla && e.resourceKey === archivo);
      if (excluido) {
        quitados += 1;
      }
      return !excluido;
    });
    return { ...run, results };
  });
  return { sarif: { ...sarif, runs }, quitados };
}
