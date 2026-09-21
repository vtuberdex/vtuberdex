/**
 * Tests del parser de fichas de detalle.
 * Los fixtures reproducen la plantilla real (terminal + 3 paneles), incluida la
 * variante sin facciones y la que trae el avatar en base64.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseDetail } from '../src/parse-detail.mjs';

const DETAIL_FIXTURE = `
<body>
  <div class="terminal">
    <div class="terminal-bar"><div class="terminal-title">user@terminal:~/vtuber-profile</div></div>
    <div class="terminal-body">
      <section class="panel">
        <div class="panel-header">Perfil / Presentación</div>
        <div class="hero">
          <div class="hero-left">
            <div class="logo-block">
              <div class="logo-image">
                <img id="mainLogo" src="logos/gkuromonochrome.png" alt="Logo PNG" />
              </div>
              <p id="vtuber-phrase">Hola causas, soy GKuro<br>pixelartista</p>
            </div>
            <div class="socials">
              <a href="https://twitter.com/GKuroMonochrome"><img src="icons/x.png" alt="X" /></a>
              <a href="https://www.twitch.tv/gkuro_monochrome"><img src="icons/twitch.png" alt="Twitch" /></a>
            </div>
            <section class="ficha">
              <div class="pais"><div class="titulo">País:</div><div class="contenido">Chile</div></div>
              <div class="dato"><div class="titulo">Cumpleaños:</div><div class="contenido">23 de Mayo</div></div>
              <div class="dato"><div class="titulo">Altura:</div><div class="contenido">1.72 m</div></div>
              <div class="dato"><div class="titulo">Color favorito:</div><div class="contenido">Blanco/Negro</div></div>
              <div class="dato"><div class="titulo">Hashtag:</div><div class="contenido">(no tengo)</div></div>
            </section>
          </div>
          <div class="hero-right">
            <div class="avatar-box">
              <div class="avatar-stage"><img id="avatarMain" src="vtubercompleto/gkuromonochrome.png" alt="Avatar PNG" /></div>
              <div class="avatar-caption" id="avatarCaption">Pose principal</div>
            </div>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-header">Stats / Facciones / Radar</div>
        <section class="bottom-section">
          <div class="left-side">
            <div class="table-wrap">
              <table class="tabla-facciones custom-table">
                <thead><tr><th>Mythical Legacy</th><th>Netherbane</th></tr></thead>
                <tbody><tr>
                  <td><img src="facciones/Mythical%20Legacy4.png" alt="Primal Monarch"></td>
                  <td><img src="facciones/Netherbane.png" alt="Netherbane"></td>
                </tr></tbody>
              </table>
            </div>
            <div class="table-wrap">
              <table class="stats-table custom-table">
                <tbody>
                  <tr><td class="stat-col">Nivel</td><td class="valor-col" id="nivel">3</td></tr>
                  <tr><td class="stat-col">EXP</td><td class="valor-col"><small class="exp-text" id="expText">65 / 500 XP</small></td></tr>
                  <tr><td class="stat-col">HP</td><td class="valor-col hp" data-max="1710" data-current="1710"></td></tr>
                  <tr><td class="stat-col">MP</td><td class="valor-col mp" data-max="1200" data-current="1200"></td></tr>
                  <tr><td class="stat-col">Ataque</td><td class="valor-col">142</td></tr>
                  <tr><td class="stat-col">Defensa Mágica</td><td class="valor-col">172</td></tr>
                </tbody>
              </table>
            </div>
          </div>
          <div class="radar-container">
            <div class="radar-image-wrap"><img src="diagrama/gkuromonochrome.png" alt="Radar del personaje"></div>
          </div>
        </section>
      </section>

      <section class="panel">
        <div class="panel-header">Skills</div>
        <section class="skills-section">
          <div class="table-wrap">
            <h2 class="section-title">Active Skills</h2>
            <table class="skills-table custom-table">
              <thead><tr><th>Facción</th><th>Tipo</th><th>Nombre</th><th>Habilidad</th></tr></thead>
              <tbody>
                <tr>
                  <td><img src="facciones/Veilbreaker.png" alt="Mythical Legacy"></td>
                  <td>Ofensivo</td>
                  <td class="force-theme">Monochrome Resolve</td>
                  <td>Ataque Mágico Base +30.<br>Si el usuario tiene menos del 50% de HP, inflige +20 daño.</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="table-wrap">
            <h2 class="section-title">Passive Skills</h2>
            <table class="skills-table custom-table">
              <thead><tr><th>Facción</th><th>Tipo</th><th>Nombre</th><th>Habilidad</th></tr></thead>
              <tbody>
                <tr>
                  <td><img src="facciones/Feastlords.png" alt=""></td>
                  <td>Soporte</td>
                  <td class="force-theme">Colorless Veil</td>
                  <td>La primera vez en cada combate que el usuario recibe Confusión, ese estado se ignora.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </div>
  </div>
  <script>
    const THEME = "#616161";
    const avatarImages = [
      { src: "Avatares/gkuromonochrome.png", caption: "Principal" },
      { src: "vtubercompleto/gkuromonochrome.png", caption: "Modelo 3D" }
    ];
  </script>
</body>
`;

const MINIMAL_FIXTURE = `
<body>
  <div class="terminal">
    <div class="terminal-bar"><div class="terminal-title">user@terminal:~/vtuber-profile</div></div>
    <div class="terminal-body">
      <section class="panel">
        <div class="panel-header">Perfil / Presentación</div>
        <div class="hero-left">
          <div class="logo-block"><img id="mainLogo" src="data:image/webp;base64,UklGRg==" alt="Logo" /></div>
          <section class="ficha"><div class="pais"><div class="titulo">País:</div><div class="contenido">Chile</div></div></section>
        </div>
        <div class="hero-right"><img id="avatarMain" src="data:image/webp;base64,AAAA" alt="Avatar" /></div>
      </section>
    </div>
  </div>
</body>
`;

test('parseDetail extrae tema, logo, frase y redes', () => {
  const detail = parseDetail(DETAIL_FIXTURE);
  assert.equal(detail.theme, '#616161');
  assert.equal(detail.logo, 'logos/gkuromonochrome.png');
  assert.equal(detail.phrase, 'Hola causas, soy GKuro\npixelartista');
  assert.equal(detail.socials.length, 2);
  assert.deepEqual(detail.socials[0], {
    platform: 'x',
    label: 'X',
    url: 'https://twitter.com/GKuroMonochrome',
    icon: 'icons/x.png',
  });
  assert.equal(detail.socials[1].platform, 'twitch');
});

test('parseDetail lee la ficha personal y deriva campos clave', () => {
  const detail = parseDetail(DETAIL_FIXTURE);
  assert.equal(detail.profile.length, 5);
  assert.equal(detail.profile[0].label, 'País');
  assert.equal(detail.profile[0].value, 'Chile');
  assert.equal(detail.birthday, '23 de Mayo');
  assert.equal(detail.height, '1.72 m');
  assert.equal(detail.favoriteColor, 'Blanco/Negro');
  assert.equal(detail.hashtag, '(no tengo)');
});

test('parseDetail separa stats numéricos, barras y EXP', () => {
  const detail = parseDetail(DETAIL_FIXTURE);
  assert.deepEqual(detail.stats.Ataque, 142);
  assert.deepEqual(detail.stats['Defensa Mágica'], 172);
  assert.deepEqual(detail.stats.HP, { current: 1710, max: 1710 });
  assert.deepEqual(detail.stats.MP, { current: 1200, max: 1200 });
  assert.equal(detail.level, 3);
  assert.deepEqual(detail.experience, { current: 65, max: 500 });
});

test('parseDetail recoge facciones sin nombres de archivo', () => {
  const detail = parseDetail(DETAIL_FIXTURE);
  assert.deepEqual(detail.factions, ['Mythical Legacy', 'Netherbane', 'Primal Monarch']);
  assert.ok(!detail.factions.some((name) => name.includes('%')));
});

test('parseDetail clasifica skills por sección y conserva el HTML del efecto', () => {
  const detail = parseDetail(DETAIL_FIXTURE);
  assert.equal(detail.skills.length, 2);
  assert.equal(detail.skills[0].category, 'active');
  assert.equal(detail.skills[0].name, 'Monochrome Resolve');
  assert.equal(detail.skills[0].type, 'Ofensivo');
  assert.equal(detail.skills[0].factions[0].name, 'Mythical Legacy');
  assert.equal(detail.skills[1].category, 'passive');
  assert.match(detail.skills[0].effect, /Ataque Mágico Base \+30\.\n/);
  assert.match(detail.skills[0].effectHtml, /<br>/);
  assert.equal(detail.radar, 'diagrama/gkuromonochrome.png');
  assert.equal(detail.hasSkills, true);
  assert.deepEqual(detail.sections, ['Perfil / Presentación', 'Stats / Facciones / Radar', 'Skills']);
});

test('parseDetail lee la galería declarada en JS', () => {
  const detail = parseDetail(DETAIL_FIXTURE);
  assert.deepEqual(detail.gallery, [
    { src: 'Avatares/gkuromonochrome.png', caption: 'Principal', isInline: false },
    { src: 'vtubercompleto/gkuromonochrome.png', caption: 'Modelo 3D', isInline: false },
  ]);
});

test('parseDetail tolera una ficha mínima con avatar embebido', () => {
  const detail = parseDetail(MINIMAL_FIXTURE);
  assert.equal(detail.theme, null);
  assert.equal(detail.socials.length, 0);
  assert.equal(detail.skills.length, 0);
  assert.equal(detail.hasSkills, false);
  assert.equal(detail.stats.Ataque, undefined);
  assert.equal(detail.gallery.length, 1);
  assert.equal(detail.gallery[0].isInline, true);
  assert.equal(detail.inlineThumbCount, 2);
});

test('parseDetail nunca lanza con HTML vacío', () => {
  const detail = parseDetail('');
  assert.equal(detail.theme, null);
  assert.deepEqual(detail.profile, []);
  assert.deepEqual(detail.skills, []);
});
