/**
 * Capturas de la app con Chrome headless (puppeteer-core sobre el binario ya
 * cacheado en el entorno). Genera vistas de escritorio y móvil para el catálogo,
 * el detalle con la carta 3D y el mantenedor.
 *
 * Uso: node scripts/screenshots.mjs [--base http://localhost:4000] [--out ../docs/shots]
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import puppeteer from 'puppeteer-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
/**
 * Lee un flag de la línea de comandos aceptando las DOS formas: `--name valor` y
 * `--name=valor`. Sin esto, `--base=http://...` se ignora en silencio y el script
 * cae al valor por defecto (`localhost:4000`), que desde dentro de un contenedor
 * no responde: el run fallaba con ERR_CONNECTION_REFUSED y parecía un fallo de red.
 */
const value = (name, fallback) => {
  const flag = `--${name}`;
  const inline = args.find((a) => a.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1) || fallback;
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const BASE = value('base', 'http://localhost:4000');
const OUT = path.resolve(value('out', path.join(HERE, '..', '..', 'docs', 'shots')));
const CHROME = value(
  'chrome',
  process.env.CHROME_PATH ?? '/opt/data/cache/chrome/chrome-headless-shell-linux64/chrome-headless-shell',
);
/**
 * Credenciales del mantenedor para las capturas del panel: SIEMPRE por entorno.
 *
 * Antes había aquí una contraseña por defecto escrita en el código. Un secreto
 * en el repositorio es un secreto filtrado: cualquiera que lea el archivo entra
 * al mantenedor. Ahora es obligatoria y las capturas que necesitan sesión se
 * OMITEN si no está definida, en vez de intentar un login con una credencial
 * inventada.
 */
const ADMIN_USER = process.env.VTUBERDEX_ADMIN ?? 'admin';
const ADMIN_PASSWORD = process.env.VTUBERDEX_ADMIN_PASSWORD ?? '';
/** Sin contraseña no se pueden capturar las vistas con sesión. */
const CAN_LOGIN = ADMIN_PASSWORD.length > 0;

/** Escenarios: cada uno produce una o más capturas. */
const SHOTS = [
  { name: 'catalog-desktop', url: '/', width: 1440, height: 960, fullPage: false, wait: 2200 },
  { name: 'catalog-desktop-full', url: '/', width: 1440, height: 960, fullPage: true, wait: 2500 },
  { name: 'catalog-mobile', url: '/', width: 390, height: 844, fullPage: false, wait: 2200, mobile: true },
  { name: 'catalog-mobile-full', url: '/', width: 390, height: 844, fullPage: true, wait: 2500, mobile: true },
  { name: 'catalog-mobile-filters', url: '/', width: 390, height: 844, wait: 1800, mobile: true, action: 'openFilters' },
  { name: 'search-result', url: '/?q=monochrome', width: 1440, height: 960, wait: 2200 },
  { name: 'search-mobile', url: '/?q=monochrome', width: 390, height: 844, wait: 2200, mobile: true },
  { name: 'detail-desktop', url: '/v/gkuro-monochrome', width: 1440, height: 1100, wait: 4200 },
  { name: 'detail-desktop-scrolled', url: '/v/gkuro-monochrome', width: 1440, height: 1100, wait: 4200, action: 'scrollDetail' },
  { name: 'detail-mobile', url: '/v/gkuro-monochrome', width: 390, height: 844, wait: 4200, mobile: true },
  { name: 'detail-mobile-scrolled', url: '/v/gkuro-monochrome', width: 390, height: 844, wait: 4200, mobile: true, action: 'scrollDetail' },
  // Las capturas del mantenedor necesitan sesión: se omiten si no hay
  // credenciales en el entorno (ver CAN_LOGIN arriba).
  { name: 'admin-login', url: '/admin', width: 1440, height: 900, wait: 1800 },
  { name: 'admin-panel', url: '/admin', width: 1440, height: 1000, wait: 1800, action: 'adminLogin', needsLogin: true },
];

async function loginAsAdmin(page) {
  await page.evaluate(
    async ({ base, user, password }) => {
      const response = await fetch(`${base}/api/admin/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: user, password }),
      });
      const payload = await response.json();
      if (payload.token) window.localStorage.setItem('vtuberdex.admin.token', payload.token);
    },
    { base: BASE, user: ADMIN_USER, password: ADMIN_PASSWORD },
  );
}

async function run() {
  await fs.mkdir(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=swiftshader',
      '--enable-unsafe-swiftshader',
      '--hide-scrollbars',
      '--force-color-profile=srgb',
    ],
  });

  // Comprobación previa de la base: si no responde, todas las capturas fallarían
  // con ERR_CONNECTION_REFUSED y el mensaje no diría por qué. Falla aquí, claro.
  try {
    const probe = await fetch(BASE, { signal: AbortSignal.timeout(8000) });
    if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
  } catch (error) {
    await browser.close().catch(() => undefined);
    console.error(`✖ La base no responde: ${BASE}`);
    console.error(`  ${String(error)}`);
    console.error('  Pasa la URL con --base <url> (desde dentro de un contenedor, la');
    console.error('  API del host suele estar en http://172.18.0.1:4000, no en localhost).');
    process.exitCode = 1;
    return;
  }

  const written = [];
  const failures = [];
  const skipped = [];

  for (const shot of SHOTS) {
    // Sin credenciales no se puede iniciar sesión: la captura se omite en vez de
    // intentar un login que fallaría y dejar una imagen engañosa.
    if (shot.needsLogin && !CAN_LOGIN) {
      skipped.push(shot.name);
      continue;
    }
    const page = await browser.newPage();
    const errors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(String(error)));

    try {
      await page.setViewport({
        width: shot.width,
        height: shot.height,
        deviceScaleFactor: shot.mobile ? 2 : 1,
        isMobile: Boolean(shot.mobile),
        hasTouch: Boolean(shot.mobile),
      });
      // `networkidle2` no converge con el bucle de render WebGL de la carta:
      // se espera el evento load y luego el tiempo propio de cada escenario.
      await page.goto(`${BASE}${shot.url}`, { waitUntil: 'load', timeout: 60000 });
      await page
        .waitForFunction(() => document.querySelector('#root')?.children.length ?? 0, { timeout: 20000 })
        .catch(() => undefined);
      if (shot.action === 'openFilters') {
        await page.waitForSelector('button[aria-haspopup="dialog"]', { timeout: 15000 });
        await page.click('button[aria-haspopup="dialog"]');
        await new Promise((resolve) => setTimeout(resolve, 600));
      }

      if (shot.action === 'scrollDetail') {
        await page.evaluate(() => window.scrollTo({ top: 900, behavior: 'instant' }));
        await new Promise((resolve) => setTimeout(resolve, 900));
      }

      if (shot.action === 'adminLogin') {
        await loginAsAdmin(page);
        await page.reload({ waitUntil: 'load' });
        // La sesión se valida contra la API: hay que esperar la lista real del
        // mantenedor (el formulario de login aparece un instante antes).
        await page.waitForSelector('aside ul button', { timeout: 25000 });
        const rows = await page.$$('aside ul button');
        if (rows.length > 0) {
          await rows[0].click();
          await page.waitForSelector('[data-testid="admin-editor"]', { timeout: 20000 });
        }
      }

      await new Promise((resolve) => setTimeout(resolve, shot.wait));
      const file = path.join(OUT, `${shot.name}.png`);
      await page.screenshot({ path: file, fullPage: Boolean(shot.fullPage) });
      written.push({ file, bytes: (await fs.stat(file)).size, errors });
    } catch (error) {
      failures.push({ shot: shot.name, error: String(error) });
    } finally {
      // Cerrar la pestaña puede fallar si el navegador murió antes (o si el
      // proceso fue interrumpido): no debe abortar el resto de las capturas.
      await page.close().catch(() => undefined);
    }
  }

  await browser.close();

  for (const shot of written) {
    console.log(`✔ ${path.basename(shot.file)} (${(shot.bytes / 1024).toFixed(0)} KB)${shot.errors.length ? ` — ${shot.errors.length} error(es) de consola` : ''}`);
    for (const error of shot.errors.slice(0, 3)) console.log(`   ! ${error.slice(0, 200)}`);
  }
  for (const failure of failures) console.log(`✖ ${failure.shot}: ${failure.error.slice(0, 300)}`);
  if (skipped.length > 0) {
    console.log(`\n⚠ omitidas por falta de credenciales (VTUBERDEX_ADMIN_PASSWORD): ${skipped.join(', ')}`);
  }
  console.log(`\n${written.length} capturas en ${OUT}`);
  if (failures.length > 0) process.exitCode = 1;
}

run().catch((error) => {
  console.error('[shots] ERROR', error);
  process.exit(1);
});
