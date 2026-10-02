/**
 * Mutaciones del catálogo: UNA definición de cómo se edita, se crea y se reordena una ficha.
 *
 * POR QUÉ ESTE MÓDULO EXISTE
 * --------------------------
 * El mantenedor escribe por DOS caminos que no se pueden unificar a nivel de infraestructura:
 *
 *   · Local: el Express escribe directamente sobre `data/vtuberdex.db`.
 *   · Producción (Vercel): el FS es de solo lectura, así que cada cambio se guarda como una
 *     OPERACIÓN en Turso (`lib/diario.mjs`) y se reproduce sobre una copia de la base empaquetada.
 *
 * Si cada camino tuviera su propia lógica, "el número 777 está ocupado" o "máximo dos facciones"
 * serían dos reglas que divergen en silencio: lo que local acepta, producción lo rechazaría.
 * Aquí viven las reglas y las dos rutas llaman a estas mismas funciones. Cada función lanza
 * `MutationError` con el estado HTTP y el código que la API devuelve tal cual.
 *
 * Ninguna abre su propia transacción salvo `aplicarOperacion`: así el llamador decide el alcance
 * (el Express añade la auditoría dentro de la misma; el reproductor de producción una por operación).
 */
import { normalizeText, slugify } from './text.mjs';

/**
 * Transacción local. NO se importa la de `db/index.mjs` a propósito: ese módulo importa éste
 * (la migración de facciones reutiliza `consolidarFacciones`) y un ciclo de módulos ESM deja
 * una de las dos mitades `undefined` según quién se cargue primero.
 */
function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const resultado = fn();
    db.exec('COMMIT');
    return resultado;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** Máximo de facciones por VTuber (regla de negocio: la carta tiene dos emblemas). */
export const MAX_FACCIONES = 2;

/**
 * Variantes de facción que el scrape trae con erratas y que NO son facciones distintas.
 *
 * El origen escribe `Netherbane2`, `Mythical Legacy3` o `Mythical Lecagy` y el seed las creaba
 * como facciones nuevas: el catálogo llegó a tener 26 cuando solo existen 22. Cada clave es el
 * slug de la variante y el valor la etiqueta CANÓNICA; el seed y la migración usan esta misma
 * tabla, así que re-scrapear no vuelve a abrir los duplicados.
 */
export const FACCION_ALIAS = {
  netherbane2: 'Netherbane',
  'chaos-ascedant': 'Chaos Ascendant',
  'mythical-legacy3': 'Mythical Legacy',
  'mythical-lecagy': 'Mythical Legacy',
};

/** Primer id que se reserva a las cartas creadas desde el mantenedor en producción. */
export const ID_BASE_CARTAS_NUEVAS = 100_000;

/** Primer id que se reserva a las facciones creadas desde el mantenedor en producción. */
export const ID_BASE_FACCIONES_NUEVAS = 1_000;

export class MutationError extends Error {
  /**
   * @param {number} status Estado HTTP que la API devuelve.
   * @param {string} code   Código estable (`dex_ocupado`, `slug_duplicado`…) para la UI y los tests.
   * @param {string} [detail]
   */
  constructor(status, code, detail) {
    super(detail ?? code);
    this.name = 'MutationError';
    this.status = status;
    this.code = code;
    this.detail = detail ?? code;
  }
}

/** Mismo puntaje que usa el seed para el orden por "poder" (ver `seed.mjs`). */
const POWERS = { attack: 1.2, magicAttack: 1.3, speed: 1.1, defense: 0.8, magicDefense: 0.9, critic: 0.6 };

/**
 * Puntaje de poder de una lista de stats `{slug, value}`. Copia deliberada de la fórmula del
 * seed: el seed la calcula sobre el dataset crudo y aquí sobre las filas editadas, y las dos
 * tienen que dar lo mismo para que editar un stat no cambie el orden por poder de forma extraña.
 */
export function calcularPoder(stats) {
  if (!stats || stats.length === 0) return 0;
  const porSlug = new Map(stats.map((stat) => [stat.slug, Number(stat.value) || 0]));
  let total = 0;
  for (const [slug, peso] of Object.entries(POWERS)) total += (porSlug.get(slug) ?? 0) * peso;
  for (const stat of stats) {
    if (!(stat.slug in POWERS)) total += (Number(stat.value) || 0) * 0.3;
  }
  return Math.round(total);
}

/** Slugs conocidos de los atributos del juego; el resto se deriva del nombre. */
const STAT_SLUGS = {
  nivel: 'level',
  exp: 'exp',
  hp: 'hp',
  mp: 'mp',
  ataque: 'attack',
  defensa: 'defense',
  'ataque magico': 'magicAttack',
  'defensa magica': 'magicDefense',
  velocidad: 'speed',
  evasion: 'evasion',
  presicion: 'accuracy',
  precision: 'accuracy',
  critico: 'critic',
  suerte: 'luck',
};

export function slugDeStat(label) {
  return STAT_SLUGS[normalizeText(label)] ?? slugify(label);
}

/** Recalcula los contadores desnormalizados de las facetas. */
export function refreshFacetCounters(db) {
  db.exec(`
    UPDATE country SET vtuber_count = (
      SELECT COUNT(*) FROM vtuber_country vc JOIN vtuber v ON v.id = vc.vtuber_id
      WHERE vc.country_id = country.id AND v.status = 'published');
    UPDATE tag SET vtuber_count = (
      SELECT COUNT(*) FROM vtuber_tag vt JOIN vtuber v ON v.id = vt.vtuber_id
      WHERE vt.tag_id = tag.id AND v.status = 'published');
    UPDATE faction SET vtuber_count = (
      SELECT COUNT(*) FROM vtuber_faction vf JOIN vtuber v ON v.id = vf.vtuber_id
      WHERE vf.faction_id = faction.id AND v.status = 'published');
  `);
}

/** Recalcula el texto indexado en FTS para una carta. */
export function refreshSearchIndex(db, vtuberId) {
  const row = db
    .prepare(
      `SELECT v.name, v.phrase,
              (SELECT group_concat(t.label, ' ') FROM vtuber_tag vt JOIN tag t ON t.id = vt.tag_id WHERE vt.vtuber_id = v.id) AS tagText,
              (SELECT group_concat(c.name, ' ') FROM vtuber_country vc JOIN country c ON c.id = vc.country_id WHERE vc.vtuber_id = v.id) AS countryText,
              (SELECT group_concat(f.label, ' ') FROM vtuber_faction vf JOIN faction f ON f.id = vf.faction_id WHERE vf.vtuber_id = v.id) AS factionText
         FROM vtuber v WHERE v.id = ?`,
    )
    .get(vtuberId);
  if (!row) return;
  const tags = [row.tagText, row.countryText, row.factionText].filter(Boolean).join(' ');
  db.prepare('DELETE FROM vtuber_fts WHERE rowid = ?').run(vtuberId);
  db.prepare('INSERT INTO vtuber_fts (rowid, name, phrase, tags) VALUES (?, ?, ?, ?)').run(
    vtuberId,
    row.name,
    row.phrase ?? '',
    tags,
  );
}

function upsertTag(db, kind, label) {
  const slug = slugify(label);
  db.prepare(
    `INSERT INTO tag (kind, slug, label, vtuber_count) VALUES (?, ?, ?, 0)
     ON CONFLICT (kind, slug) DO UPDATE SET label = excluded.label`,
  ).run(kind, slug, label);
  return db.prepare('SELECT id FROM tag WHERE kind = ? AND slug = ?').get(kind, slug).id;
}

/**
 * Resuelve una facción por slug o por etiqueta. NO crea: las facciones son un catálogo cerrado
 * (22) que se administra aparte. Antes `upsertFaction` creaba la que no existía, y así fue como
 * "Mythical Lecagy" y "Netherbane2" acabaron siendo facciones distintas de las reales.
 */
export function buscarFaccion(db, valor) {
  const clave = String(valor ?? '').trim();
  if (!clave) return null;
  return (
    db.prepare('SELECT id, slug, label FROM faction WHERE slug = ? OR lower(label) = lower(?)').get(clave, clave) ??
    db.prepare('SELECT id, slug, label FROM faction WHERE slug = ?').get(slugify(clave)) ??
    null
  );
}

/** Reemplaza las relaciones multivaluadas de una carta. */
export function replaceRelations(db, vtuberId, patch) {
  if (patch.countries) {
    db.prepare('DELETE FROM vtuber_country WHERE vtuber_id = ?').run(vtuberId);
    const insert = db.prepare('INSERT OR IGNORE INTO vtuber_country (vtuber_id, country_id, position) VALUES (?, ?, ?)');
    patch.countries.forEach((slug, index) => {
      const country = db.prepare('SELECT id FROM country WHERE slug = ?').get(slug);
      if (!country) throw new MutationError(422, 'pais_desconocido', `país desconocido: ${slug}`);
      insert.run(vtuberId, country.id, index);
    });
  }
  if (patch.languages) {
    db.prepare('DELETE FROM vtuber_language WHERE vtuber_id = ?').run(vtuberId);
    const insert = db.prepare('INSERT OR IGNORE INTO vtuber_language (vtuber_id, code) VALUES (?, ?)');
    patch.languages.forEach((code) => insert.run(vtuberId, code));
  }
  if (patch.groups) {
    db.prepare(`DELETE FROM vtuber_tag WHERE vtuber_id = ? AND tag_id IN (SELECT id FROM tag WHERE kind = 'group')`).run(vtuberId);
    const insert = db.prepare('INSERT OR IGNORE INTO vtuber_tag (vtuber_id, tag_id, position) VALUES (?, ?, ?)');
    patch.groups.forEach((label, index) => insert.run(vtuberId, upsertTag(db, 'group', label), index));
  }
  if (patch.artists) {
    db.prepare(`DELETE FROM vtuber_tag WHERE vtuber_id = ? AND tag_id IN (SELECT id FROM tag WHERE kind = 'artist')`).run(vtuberId);
    const insert = db.prepare('INSERT OR IGNORE INTO vtuber_tag (vtuber_id, tag_id, position) VALUES (?, ?, ?)');
    patch.artists.forEach((label, index) => insert.run(vtuberId, upsertTag(db, 'artist', label), index));
  }
  if (patch.factions) {
    // Se resuelve TODO antes de tocar nada: un valor desconocido no puede dejar a la carta sin facciones.
    const resueltas = [];
    for (const valor of patch.factions) {
      const faccion = buscarFaccion(db, valor);
      if (!faccion) throw new MutationError(422, 'faccion_desconocida', `facción desconocida: ${valor}`);
      if (!resueltas.some((f) => f.id === faccion.id)) resueltas.push(faccion);
    }
    if (resueltas.length > MAX_FACCIONES) {
      throw new MutationError(400, 'demasiadas_facciones', `máximo ${MAX_FACCIONES} facciones por VTuber`);
    }
    db.prepare('DELETE FROM vtuber_faction WHERE vtuber_id = ?').run(vtuberId);
    const insert = db.prepare('INSERT OR IGNORE INTO vtuber_faction (vtuber_id, faction_id, position) VALUES (?, ?, ?)');
    resueltas.forEach((faccion, index) => insert.run(vtuberId, faccion.id, index));
  }
}

/** Reemplaza las filas hijas editables (perfil, stats, skills, redes). */
export function replaceChildren(db, vtuberId, patch) {
  if (patch.profile) {
    db.prepare('DELETE FROM profile_field WHERE vtuber_id = ?').run(vtuberId);
    const insert = db.prepare('INSERT INTO profile_field (vtuber_id, label, value, position) VALUES (?, ?, ?, ?)');
    patch.profile.forEach((field, index) => insert.run(vtuberId, field.label, field.value, index));
  }
  if (patch.stats) {
    db.prepare('DELETE FROM stat WHERE vtuber_id = ?').run(vtuberId);
    const insert = db.prepare(
      'INSERT INTO stat (vtuber_id, label, slug, value, value_text, max, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    const normalizadas = patch.stats.map((stat) => ({
      label: stat.label,
      slug: stat.slug || slugDeStat(stat.label),
      value: stat.value ?? null,
      valueText: stat.valueText ?? null,
      max: stat.max ?? null,
    }));
    normalizadas.forEach((stat, index) =>
      insert.run(vtuberId, stat.label, stat.slug, stat.value, stat.valueText, stat.max, index),
    );
    // Las columnas desnormalizadas (poder, hp, mp) salen de las filas: editar un atributo tiene
    // que mover también el orden por "poder", que es lo que ordena el catálogo.
    const hp = normalizadas.find((stat) => stat.slug === 'hp');
    const mp = normalizadas.find((stat) => stat.slug === 'mp');
    db.prepare(
      'UPDATE vtuber SET power_score = ?, hp_current = ?, hp_max = ?, mp_current = ?, mp_max = ? WHERE id = ?',
    ).run(calcularPoder(normalizadas), hp?.value ?? null, hp?.max ?? null, mp?.value ?? null, mp?.max ?? null, vtuberId);
  }
  if (patch.skills) {
    db.prepare('DELETE FROM skill WHERE vtuber_id = ?').run(vtuberId);
    const insert = db.prepare(
      `INSERT INTO skill (vtuber_id, category, section, type, name, effect, effect_html, factions, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    patch.skills.forEach((skill, index) =>
      insert.run(
        vtuberId,
        skill.category ?? 'other',
        skill.section ?? null,
        skill.type ?? null,
        skill.name ?? null,
        skill.effect ?? null,
        // El HTML original del scrape ya no describe el texto editado: se descarta.
        null,
        JSON.stringify(skill.factions ?? []),
        index,
      ),
    );
  }
  if (patch.socials) {
    db.prepare('DELETE FROM social WHERE vtuber_id = ?').run(vtuberId);
    const insert = db.prepare('INSERT INTO social (vtuber_id, platform, label, url, icon, position) VALUES (?, ?, ?, ?, ?, ?)');
    patch.socials.forEach((social, index) =>
      insert.run(vtuberId, social.platform, social.label ?? null, social.url, social.icon ?? null, index),
    );
  }
}

/** Mayor número de dex en uso, o 0. */
export function ultimoDex(db) {
  return db.prepare('SELECT COALESCE(MAX(dex_number), 0) AS n FROM vtuber').get().n;
}

/**
 * Resuelve el número pedido: `'end'` es "al final" (el siguiente al mayor en uso) y un entero
 * debe estar LIBRE. Se rechaza en vez de intercambiar: pisar el número de otra carta sin
 * avisar cambiaría su URL de referencia (`#777`) por un efecto colateral que nadie pidió.
 */
export function resolverDex(db, pedido, { excluirId = null } = {}) {
  if (pedido === 'end') return ultimoDex(db) + 1;
  const numero = Number(pedido);
  if (!Number.isInteger(numero) || numero < 1) {
    throw new MutationError(400, 'dex_invalido', 'el número debe ser un entero positivo');
  }
  const dueño = db.prepare('SELECT id, name FROM vtuber WHERE dex_number = ?').get(numero);
  if (dueño && dueño.id !== excluirId) {
    throw new MutationError(409, 'dex_ocupado', `el #${numero} ya lo tiene ${dueño.name}`);
  }
  return numero;
}

/** Valida y normaliza un slug explícito. */
function slugValido(valor) {
  const slug = slugify(valor);
  if (!slug) throw new MutationError(400, 'slug_invalido', 'la URL no puede quedar vacía');
  if (slug.length > 80) throw new MutationError(400, 'slug_invalido', 'la URL admite como máximo 80 caracteres');
  return slug;
}

/**
 * Cambia el slug de una carta y deja el anterior como alias.
 *
 * El alias hace que `/v/<slug-viejo>` siga resolviendo (el detalle redirige al nuevo): sin él,
 * renombrar una página rompería cada enlace compartido sin avisar.
 */
function cambiarSlug(db, id, actual, nuevo) {
  const slug = slugValido(nuevo);
  if (slug === actual) return;
  const choque = db.prepare('SELECT id FROM vtuber WHERE slug = ? AND id != ?').get(slug, id);
  if (choque) throw new MutationError(409, 'slug_duplicado', slug);
  // Un alias de OTRA carta con ese nombre pierde frente a un slug real; el de ESTA ya no hace falta.
  db.prepare('DELETE FROM slug_alias WHERE slug = ?').run(slug);
  db.prepare('INSERT OR REPLACE INTO slug_alias (slug, vtuber_id) VALUES (?, ?)').run(actual, id);
  db.prepare('UPDATE vtuber SET slug = ? WHERE id = ?').run(slug, id);
}

const COLUMNAS = {
  name: 'name',
  phrase: 'phrase',
  cardText: 'card_text',
  themeColor: 'theme_color',
  secondaryColor: 'secondary_color',
  birthday: 'birthday',
  height: 'height',
  hashtag: 'hashtag',
  favoriteColor: 'favorite_color',
  status: 'status',
  level: 'level',
};

/**
 * Aplica un parche a una ficha existente. Debe correr dentro de una transacción.
 * Devuelve el slug resultante (puede haber cambiado).
 */
export function aplicarParche(db, id, patch) {
  const actual = db.prepare('SELECT id, slug, dex_number AS dex FROM vtuber WHERE id = ?').get(id);
  if (!actual) throw new MutationError(404, 'no_encontrado', `no existe la ficha ${id}`);

  const sets = [];
  const args = [];
  for (const [campo, columna] of Object.entries(COLUMNAS)) {
    if (patch[campo] === undefined) continue;
    sets.push(`${columna} = ?`);
    args.push(patch[campo]);
  }
  if (patch.name !== undefined) {
    // El slug NO sigue al nombre: la URL es una decisión propia (campo `slug`). Antes cada cambio
    // de nombre reescribía la URL y rompía los enlaces compartidos sin que nadie lo pidiera.
    sets.push('search_name = ?');
    args.push(normalizeText(patch.name));
  }
  if (patch.dexNumber !== undefined) {
    sets.push('dex_number = ?');
    args.push(resolverDex(db, patch.dexNumber, { excluirId: id }));
  }
  // Cambiar el slug antes del UPDATE general: puede lanzar y la transacción lo deshace todo.
  if (patch.slug !== undefined) cambiarSlug(db, id, actual.slug, patch.slug);
  if (sets.length > 0) {
    db.prepare(`UPDATE vtuber SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...args, id);
  }
  replaceRelations(db, id, patch);
  replaceChildren(db, id, patch);
  refreshSearchIndex(db, id);
  refreshFacetCounters(db);
  return db.prepare('SELECT slug FROM vtuber WHERE id = ?').get(id).slug;
}

/**
 * Crea una carta nueva. Debe correr dentro de una transacción.
 *
 * Nace como BORRADOR salvo que se pida otra cosa: una carta sin imagen no debería aparecer en el
 * catálogo público hasta que alguien la publique a propósito.
 *
 * @param {object} datos Mismos campos que el parche, con `name` obligatorio.
 * @param {{ id?: number }} [opciones] `id` explícito: el reproductor de producción lo fija para que
 *   cada instancia cree la carta con el MISMO id.
 */
export function crearFicha(db, datos, { id = null } = {}) {
  const nombre = String(datos.name ?? '').trim();
  if (!nombre) throw new MutationError(400, 'nombre_requerido', 'falta el nombre');
  const slug = slugValido(datos.slug ?? nombre);
  if (db.prepare('SELECT 1 FROM vtuber WHERE slug = ?').get(slug)) throw new MutationError(409, 'slug_duplicado', slug);
  const dex = resolverDex(db, datos.dexNumber ?? 'end');

  const columnas = ['dex_number', 'slug', 'name', 'search_name', 'status', 'has_detail'];
  const valores = [dex, slug, nombre, normalizeText(nombre), datos.status ?? 'draft', 1];
  if (id !== null) {
    columnas.unshift('id');
    valores.unshift(id);
  }
  db.prepare(`INSERT INTO vtuber (${columnas.join(', ')}) VALUES (${columnas.map(() => '?').join(', ')})`).run(...valores);
  const nuevoId = db.prepare('SELECT id FROM vtuber WHERE slug = ?').get(slug).id;

  // El resto de campos entra por el mismo camino que una edición.
  const { name: _nombre, slug: _slug, dexNumber: _dex, ...resto } = datos;
  aplicarParche(db, nuevoId, resto);
  return { id: nuevoId, slug };
}

// ---------------------------------------------------------------- facciones

/**
 * Deja las facciones en su estado canónico: fusiona las variantes con errata (`FACCION_ALIAS`),
 * recorta a `MAX_FACCIONES` por carta y reindexa lo que cambió.
 *
 * Es idempotente. La usa la migración que limpia las bases existentes; el seed aplica las mismas
 * reglas al insertar, así que una base recién sembrada ya sale limpia y esto no encuentra nada.
 */
export function consolidarFacciones(db) {
  const resultado = { fusionadas: 0, recortadas: 0 };
  transaction(db, () => {
    for (const [slugVariante, etiqueta] of Object.entries(FACCION_ALIAS)) {
      const variante = db.prepare('SELECT id FROM faction WHERE slug = ?').get(slugVariante);
      if (!variante) continue;
      const canonica = db.prepare('SELECT id FROM faction WHERE lower(label) = lower(?)').get(etiqueta);
      if (canonica) {
        db.prepare('UPDATE OR IGNORE vtuber_faction SET faction_id = ? WHERE faction_id = ?').run(canonica.id, variante.id);
      }
      db.prepare('DELETE FROM vtuber_faction WHERE faction_id = ?').run(variante.id);
      db.prepare('DELETE FROM faction WHERE id = ?').run(variante.id);
      resultado.fusionadas += 1;
    }
    const sobrantes = db
      .prepare(
        `DELETE FROM vtuber_faction WHERE (
           SELECT COUNT(*) FROM vtuber_faction b
            WHERE b.vtuber_id = vtuber_faction.vtuber_id
              AND (b.position < vtuber_faction.position
                   OR (b.position = vtuber_faction.position AND b.faction_id < vtuber_faction.faction_id))
         ) >= ?`,
      )
      .run(MAX_FACCIONES);
    resultado.recortadas = Number(sobrantes.changes);
    // Las posiciones quedan 0..n-1 sin huecos.
    const filas = db.prepare('SELECT vtuber_id AS v, faction_id AS f FROM vtuber_faction ORDER BY vtuber_id, position, faction_id').all();
    const mover = db.prepare('UPDATE vtuber_faction SET position = ? WHERE vtuber_id = ? AND faction_id = ?');
    let actual = null;
    let indice = 0;
    for (const { v, f } of filas) {
      indice = v === actual ? indice + 1 : 0;
      actual = v;
      mover.run(indice, v, f);
    }
    db.prepare('SELECT id FROM vtuber').all().forEach((fila) => refreshSearchIndex(db, fila.id));
    refreshFacetCounters(db);
  });
  return resultado;
}

/** Facciones con su conteo real, para el administrador de facciones. */
export function listarFacciones(db) {
  return db
    .prepare(
      `SELECT f.id, f.slug, f.label, f.icon,
              (SELECT COUNT(*) FROM vtuber_faction vf WHERE vf.faction_id = f.id) AS total,
              (SELECT COUNT(*) FROM vtuber_faction vf JOIN vtuber v ON v.id = vf.vtuber_id
                WHERE vf.faction_id = f.id AND v.status = 'published') AS publicadas
         FROM faction f ORDER BY f.label COLLATE NOCASE`,
    )
    .all()
    .map((fila) => ({ ...fila }));
}

/** Crea una facción. Debe correr dentro de una transacción. */
export function crearFaccion(db, { label, icon = null }, { id = null } = {}) {
  const etiqueta = String(label ?? '').trim();
  if (!etiqueta) throw new MutationError(400, 'nombre_requerido', 'falta el nombre de la facción');
  const slug = slugValido(etiqueta);
  if (db.prepare('SELECT 1 FROM faction WHERE slug = ? OR lower(label) = lower(?)').get(slug, etiqueta)) {
    throw new MutationError(409, 'faccion_duplicada', `ya existe la facción ${etiqueta}`);
  }
  if (id !== null) {
    db.prepare('INSERT INTO faction (id, slug, label, icon, vtuber_count) VALUES (?, ?, ?, ?, 0)').run(id, slug, etiqueta, icon);
  } else {
    db.prepare('INSERT INTO faction (slug, label, icon, vtuber_count) VALUES (?, ?, ?, 0)').run(slug, etiqueta, icon);
  }
  return db.prepare('SELECT id, slug, label, icon FROM faction WHERE slug = ?').get(slug);
}

/** Renombra o cambia el emblema de una facción. El slug se conserva: es el que va en las URLs de filtro. */
export function editarFaccion(db, id, { label, icon }) {
  const actual = db.prepare('SELECT id, label FROM faction WHERE id = ?').get(id);
  if (!actual) throw new MutationError(404, 'no_encontrado', `no existe la facción ${id}`);
  if (label !== undefined) {
    const etiqueta = String(label).trim();
    if (!etiqueta) throw new MutationError(400, 'nombre_requerido', 'falta el nombre de la facción');
    const choque = db.prepare('SELECT id FROM faction WHERE lower(label) = lower(?) AND id != ?').get(etiqueta, id);
    if (choque) throw new MutationError(409, 'faccion_duplicada', `ya existe la facción ${etiqueta}`);
    db.prepare('UPDATE faction SET label = ? WHERE id = ?').run(etiqueta, id);
  }
  if (icon !== undefined) db.prepare('UPDATE faction SET icon = ? WHERE id = ?').run(icon, id);
  const ids = db.prepare('SELECT vtuber_id AS id FROM vtuber_faction WHERE faction_id = ?').all(id);
  ids.forEach((fila) => refreshSearchIndex(db, fila.id));
  return db.prepare('SELECT id, slug, label, icon FROM faction WHERE id = ?').get(id);
}

/**
 * Elimina una facción. Con `fusionarEn` las cartas que la tenían pasan a la otra (es como se
 * limpian los duplicados); sin él simplemente la pierden. Respeta el máximo: si una carta ya
 * tiene dos facciones y una es la destino, la fusión no añade una tercera.
 */
export function eliminarFaccion(db, id, { fusionarEn = null } = {}) {
  const faccion = db.prepare('SELECT id FROM faction WHERE id = ?').get(id);
  if (!faccion) throw new MutationError(404, 'no_encontrado', `no existe la facción ${id}`);
  if (fusionarEn !== null) {
    if (fusionarEn === id) throw new MutationError(400, 'fusion_invalida', 'no se puede fusionar una facción consigo misma');
    const destino = db.prepare('SELECT id FROM faction WHERE id = ?').get(fusionarEn);
    if (!destino) throw new MutationError(404, 'no_encontrado', `no existe la facción destino ${fusionarEn}`);
    const afectadas = db.prepare('SELECT vtuber_id AS id, position FROM vtuber_faction WHERE faction_id = ?').all(id);
    for (const { id: vtuberId, position } of afectadas) {
      const yaLaTiene = db.prepare('SELECT 1 FROM vtuber_faction WHERE vtuber_id = ? AND faction_id = ?').get(vtuberId, fusionarEn);
      if (!yaLaTiene) {
        db.prepare('UPDATE vtuber_faction SET faction_id = ? WHERE vtuber_id = ? AND faction_id = ?').run(fusionarEn, vtuberId, id);
        db.prepare('UPDATE vtuber_faction SET position = ? WHERE vtuber_id = ? AND faction_id = ?').run(position, vtuberId, fusionarEn);
      }
    }
  }
  db.prepare('DELETE FROM vtuber_faction WHERE faction_id = ?').run(id);
  db.prepare('DELETE FROM faction WHERE id = ?').run(id);
  const todas = db.prepare('SELECT id FROM vtuber').all();
  todas.forEach((fila) => refreshSearchIndex(db, fila.id));
  refreshFacetCounters(db);
}

// ----------------------------------------------------------- operaciones

/**
 * Una operación del diario de producción, aplicada sobre `db` en UNA transacción.
 *
 * El diario guarda `{tipo, ...}` tal cual llegó validado; esta función es lo que lo convierte en
 * cambios. Devuelve un resumen (`slug`, `id`…) para que el llamador pueda responder sin
 * volver a consultar.
 */
export function aplicarOperacion(db, operacion) {
  return transaction(db, () => {
    switch (operacion.tipo) {
      case 'vtuber.editar': {
        const slug = aplicarParche(db, operacion.id, operacion.patch);
        return { id: operacion.id, slug };
      }
      case 'vtuber.crear': {
        const creada = crearFicha(db, operacion.datos, { id: operacion.id });
        refreshFacetCounters(db);
        return creada;
      }
      case 'vtuber.estado': {
        const update = db.prepare(`UPDATE vtuber SET status = ?, updated_at = datetime('now') WHERE id = ?`);
        operacion.ids.forEach((id) => update.run(operacion.status, id));
        refreshFacetCounters(db);
        return { ids: operacion.ids };
      }
      case 'faccion.crear':
        return crearFaccion(db, operacion.datos, { id: operacion.id });
      case 'faccion.editar':
        return editarFaccion(db, operacion.id, operacion.patch);
      case 'faccion.eliminar':
        eliminarFaccion(db, operacion.id, { fusionarEn: operacion.fusionarEn ?? null });
        return { id: operacion.id };
      default:
        throw new MutationError(400, 'operacion_desconocida', String(operacion.tipo));
    }
  });
}
