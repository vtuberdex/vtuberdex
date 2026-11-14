// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * Parser de las fichas de detalle (`/NombreSlug`).
 *
 * Cada ficha es una "terminal" con 3 paneles: Perfil/Presentación, Stats y
 * Skills. Las páginas son plantillas copiadas a mano, así que la estructura
 * varía (faltan facciones, faltan stats, el avatar viene en base64...). El
 * parser es defensivo: devuelve lo que exista y nunca lanza por un campo
 * ausente.
 */
import { load } from "cheerio";

/** Texto plano conservando saltos de línea de los `<br>`. */
function textWithBreaks($, element) {
  const clone = $(element).clone();
  clone.find("br").replaceWith("\n");
  return clone
    .text()
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(
      (line, index, all) => line !== "" || (index > 0 && all[index - 1] !== ""),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function toNumber(value) {
  const match = /-?\d+/.exec(String(value ?? "").replaceAll(".", ""));
  return match ? Number(match[0]) : null;
}

/** Nombre de plataforma a partir del icono (`icons/twitch.png` -> twitch). */
function platformFromIcon(src) {
  const file =
    String(src ?? "")
      .split("/")
      .pop() ?? "";
  return file.replace(/\.[a-z0-9]+$/i, "").toLowerCase() || "web";
}

/** Etiqueta de una fila de la ficha o de stats, sin los dos puntos finales. */
function rowLabel(row, selector) {
  return row
    .find(selector)
    .text()
    .replace(/\s+/g, " ")
    .replace(/[:：]\s*$/, "")
    .trim();
}

/** Tema de color declarado en el propio script de la ficha. */
function readTheme(scriptText) {
  const themeMatch = /const\s+THEME\s*=\s*["']([^"']+)["']/.exec(scriptText);
  return themeMatch ? themeMatch[1].trim() : null;
}

function readSocials($) {
  const socials = [];
  $(".socials a[href]").each((_, el) => {
    const anchor = $(el);
    const url = anchor.attr("href")?.trim();
    if (!url) {
      return;
    }
    const icon = anchor.find("img").attr("src")?.trim() ?? null;
    socials.push({
      platform: platformFromIcon(icon),
      label: anchor.find("img").attr("alt")?.trim() || platformFromIcon(icon),
      url,
      icon,
    });
  });
  return socials;
}

function readProfile($) {
  const profile = [];
  $(".ficha .dato, .ficha .pais").each((_, el) => {
    const row = $(el);
    const label = rowLabel(row, ".titulo");
    const value = textWithBreaks($, row.find(".contenido"));
    if (label && value) {
      profile.push({ label, value });
    }
  });
  return profile;
}

/** Valor de la primera fila de la ficha cuya etiqueta cumple `pattern`. */
function profileValue(profile, pattern) {
  return profile.find((row) => pattern.test(row.label))?.value ?? null;
}

function looksLikeFilename(value) {
  return value.includes("%") || /\.(png|jpe?g|webp|gif)$/i.test(value);
}

function readFactions($) {
  const factions = [];
  $(".tabla-facciones thead th").each((_, el) => {
    const name = $(el).text().replace(/\s+/g, " ").trim();
    if (name) {
      factions.push(name);
    }
  });
  $('img[src*="facciones"]').each((_, el) => {
    const alt = $(el).attr("alt")?.trim();
    if (!alt || looksLikeFilename(alt)) {
      return;
    }
    if (!factions.some((name) => name.toLowerCase() === alt.toLowerCase())) {
      factions.push(alt);
    }
  });
  return factions;
}

function readStats($) {
  const stats = {};
  $(".stats-table tr").each((_, el) => {
    const row = $(el);
    const label = rowLabel(row, ".stat-col");
    if (!label) {
      return;
    }
    const cell = row.find(".valor-col");
    if (cell.find(".stat-bar-wrapper").length > 0 || cell.attr("data-max")) {
      stats[label] = {
        current: toNumber(
          cell.attr("data-current") ?? cell.find(".stat-value").text(),
        ),
        max: toNumber(cell.attr("data-max")),
      };
      return;
    }
    const value = cell.text().replace(/\s+/g, " ").trim();
    if (value) {
      stats[label] = toNumber(value) ?? value;
    }
  });
  return stats;
}

function readExperience($) {
  const expText = $("#expText").text().trim();
  // El lookbehind impide empezar a mitad de una tira de dígitos: el resultado
  // es el mismo (el match más a la izquierda empieza siempre al inicio de la
  // tira) y la búsqueda deja de reintentar cada posición de la tira.
  const expMatch = /(?<![\d.,])([\d.,]+)\s*\/\s*([\d.,]+)/.exec(expText);
  return expMatch
    ? { current: toNumber(expMatch[1]), max: toNumber(expMatch[2]) }
    : null;
}

/** Galería: `avatarImages` declarado en JS o, si no, el avatar principal. */
function readGallery($, scriptText) {
  const gallery = [];
  const galleryMatch = /const\s+avatarImages\s*=\s*\[([\s\S]*?)\];/.exec(
    scriptText,
  );
  if (galleryMatch) {
    const entryRe =
      /src:\s*["']([^"']+)["']\s*,\s*caption:\s*["']([^"']*)["']/g;
    let match;
    while ((match = entryRe.exec(galleryMatch[1])) !== null) {
      gallery.push({
        src: match[1].trim(),
        caption: match[2].trim() || null,
        isInline: false,
      });
    }
  }
  const inlineAvatar = $("#avatarMain").attr("src")?.trim() ?? null;
  if (gallery.length === 0 && inlineAvatar) {
    gallery.push({
      src: inlineAvatar,
      caption: "Pose principal",
      isInline: inlineAvatar.startsWith("data:"),
    });
  }
  return gallery;
}

/** Categoría de la tabla de habilidades a partir del título de su sección. */
function categoryOfSection(section) {
  if (/active/i.test(section)) {
    return "active";
  }
  if (/passive/i.test(section)) {
    return "passive";
  }
  if (/ultimate/i.test(section)) {
    return "ultimate";
  }
  return (section || "other").toLowerCase();
}

function readSkillRow($, row, index, category, section) {
  const cells = $(row).find("td");
  if (cells.length < 3) {
    return null;
  }
  const factionIcons = cells
    .eq(0)
    .find("img")
    .map((__, img) => ({
      src: $(img).attr("src")?.trim() ?? null,
      name: $(img).attr("alt")?.trim() || null,
    }))
    .get();
  const withText = factionIcons.length === 0;
  const offset = withText ? 0 : 1;
  const type = cells.eq(offset).text().replace(/\s+/g, " ").trim();
  const name = cells
    .eq(offset + 1)
    .text()
    .replace(/\s+/g, " ")
    .trim();
  const effectNode = cells.eq(offset + 2);
  const effectHtml = (effectNode.html() ?? "").trim();
  const effect = textWithBreaks($, effectNode);
  if (!name && !effect) {
    return null;
  }
  return {
    category,
    section: section || null,
    type: type || null,
    name: name || null,
    effect,
    effectHtml,
    factions: factionIcons,
    position: index,
  };
}

function readSkills($) {
  const skills = [];
  $(".skills-section .table-wrap").each((_, wrap) => {
    const section = $(wrap)
      .find("h2.section-title")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim();
    const category = categoryOfSection(section);

    $(wrap)
      .find("table tbody tr")
      .each((index, row) => {
        const skill = readSkillRow($, row, index, category, section);
        if (skill) {
          skills.push(skill);
        }
      });
  });
  return skills;
}

export function parseDetail(html) {
  const $ = load(html, { decodeEntities: true });

  const scriptText = $("script")
    .map((_, el) => $(el).html() ?? "")
    .get()
    .join("\n");
  const phraseHtml = $("#vtuber-phrase").html() ?? "";
  const profile = readProfile($);
  const skills = readSkills($);

  return {
    theme: readTheme(scriptText),
    logo: $("#mainLogo").attr("src")?.trim() ?? null,
    phrase: textWithBreaks($, "#vtuber-phrase"),
    phraseHtml: phraseHtml.trim() || null,
    socials: readSocials($),
    profile,
    birthday: profileValue(profile, /cumplea/i),
    height: profileValue(profile, /altura/i),
    hashtag: profileValue(profile, /hashtag/i),
    favoriteColor: profileValue(profile, /color fav/i),
    factions: readFactions($),
    stats: readStats($),
    level: toNumber($("#nivel").text()),
    experience: readExperience($),
    radar: $(".radar-image-wrap img").attr("src")?.trim() ?? null,
    gallery: readGallery($, scriptText),
    // Solo se guarda el CONTEO de imágenes embebidas; el scraper descarta el
    // base64 antes de persistir (infla el dataset sin aportar información).
    inlineThumbCount: $('img[src^="data:image"]').length,
    skills,
    // Nivel de riqueza de la ficha.
    sections: $(".panel-header")
      .map((_, el) => $(el).text().trim())
      .get(),
    hasSkills: skills.length > 0,
  };
}
