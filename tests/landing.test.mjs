// node --test · comprueba que el menú apunta donde debe y que cada sección existe.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const js = readFileSync('web/assets/site.js', 'utf8');
const toml = readFileSync('netlify.toml', 'utf8');
const inicio = readFileSync('web/index.html', 'utf8');

const ESPERADO = [
  ['Social Tennis Events', '/social-events'],
  ['Tournaments', '/tournaments'],
  ['Lessons', '/lessons'],
  ['Shop', 'https://tennisinsane.com/'],
  ['About', '/about'],
  ['Contact', '/contact'],
];

test('el menú tiene las 6 entradas, en orden y con su destino', () => {
  const nav = [...js.matchAll(/\{ href: ([^,]+),\s+en: '([^']+)'/g)].map((m) => [m[2], m[1].trim()]);
  assert.deepEqual(nav.map((n) => n[0]), ESPERADO.map((e) => e[0]));
  for (const [nombre, destino] of ESPERADO) {
    const valor = nav.find((n) => n[0] === nombre)[1];
    if (destino.startsWith('http')) assert.ok(valor === 'SHOP' && js.includes(`var SHOP = '${destino}'`), nombre);
    else assert.equal(valor, `'${destino}'`, nombre);
  }
});

test('cada sección interna existe y tiene su ruta en netlify.toml', () => {
  for (const [, destino] of ESPERADO.filter((e) => !e[1].startsWith('http'))) {
    assert.ok(existsSync(`web${destino}/index.html`), `falta web${destino}/index.html`);
    assert.match(toml, new RegExp(`from = "${destino}"\\s+to = "${destino}/index.html"`), destino);
  }
});

test('la portada ya no se redirige a /join y enlaza a la comunidad y a Instagram', () => {
  assert.doesNotMatch(toml, /from = "\/"\s/);
  assert.ok(existsSync('web/index.html'));
  assert.match(inicio, /href="\/join"/);
  assert.match(inicio, /href="https:\/\/www\.instagram\.com\/tennisinsane\/"/);
});

test('las páginas en construcción dicen que están en construcción', () => {
  for (const s of ['social-events', 'lessons', 'about', 'contact']) {
    const h = readFileSync(`web/${s}/index.html`, 'utf8');
    assert.match(h, /Under construction/); assert.match(h, /En construcción/);
  }
});

test('la portada es solo logo y menú, frase y dos botones; sin pie ni más secciones', () => {
  assert.match(inicio, /<body class="home" data-no-footer>/);
  assert.equal((inicio.match(/class="nbtn nbtn-(primary|white)"/g) || []).length, 2);
  assert.doesNotMatch(inicio, /<section|<footer/);
});

test('las páginas comparten cabecera: nav.css y site.js (también /tournaments), sin cabecera propia', () => {
  for (const f of ['web/index.html', 'web/about/index.html', 'web/tournaments/index.html']) {
    const h = readFileSync(f, 'utf8');
    assert.match(h, /href="\/assets\/nav\.css"/, f);
    assert.match(h, /src="\/assets\/site\.js"/, f);
  }
  const torneo = readFileSync('web/tournaments/index.html', 'utf8');
  assert.doesNotMatch(torneo, /<header class="top"/);
  assert.match(torneo, /ti:lang/);          // escucha el idioma elegido en el menú
  assert.doesNotMatch(torneo, /role="alert"><\/div>\s*<div class="hint"/);
});

test('los enlaces que abren pestaña nueva lo avisan a los lectores de pantalla', () => {
  for (const f of ['web/index.html', 'web/lessons/index.html', 'web/contact/index.html', 'web/assets/site.js']) {
    const h = readFileSync(f, 'utf8');
    assert.match(h, /target="_blank"/, f);
    assert.match(h, /class="sr"/, f);   // el aviso «se abre en una pestaña nueva» solo para lectores de pantalla
  }
});

test('existen favicon e imagen para compartir', () => {
  assert.ok(existsSync('web/assets/icon.png'));
  assert.ok(existsSync('web/assets/og.jpg'));
  assert.match(readFileSync('web/index.html', 'utf8'), /og:image/);
});

test('toda clase que usan la portada y las páginas en construcción tiene su estilo (evita botones «sin estilo»)', () => {
  const css = readFileSync('web/assets/nav.css', 'utf8') + readFileSync('web/assets/site.css', 'utf8');
  const sinEstilo = new Set();
  for (const f of ['web/index.html', 'web/about/index.html', 'web/lessons/index.html', 'web/contact/index.html', 'web/social-events/index.html', 'web/privacy/index.html', 'web/disclaimer/index.html']) {
    const h = readFileSync(f, 'utf8');
    for (const m of h.matchAll(/class="([^"]+)"/g)) for (const c of m[1].split(/\s+/)) {
      if (!new RegExp(`\\.${c.replace(/-/g, '\\-')}(?![\\w-])`).test(css)) sinEstilo.add(`${f}: .${c}`);
    }
  }
  assert.deepEqual([...sinEstilo], []);
});

test('las variables --n-* de nav.css están definidas en :root (los botones fuera de la cabecera también las usan)', () => {
  const css = readFileSync('web/assets/nav.css', 'utf8');
  const raiz = css.match(/:root\{([^}]*)\}/)[1];
  const usadas = new Set([...css.matchAll(/var\((--n-[\w-]+)\)/g)].map((m) => m[1]));
  for (const v of usadas) assert.match(raiz, new RegExp(`${v}:`), `${v} no está en :root`);
});

test('la portada lleva el titular y el subtítulo acordados, en inglés y en español', () => {
  assert.match(inicio, /Madrid’s International Tennis Community/);
  assert.match(inicio, /Play fun games, meet people from all over the world, and enjoy the after-tennis\./);
  assert.match(inicio, /La comunidad internacional de tenis en Madrid/);
  assert.match(inicio, /Juega formatos divertidos, conoce gente de todo el mundo y disfruta del tercer tiempo\./);
});

test('el alta ya no ofrece pádel social y «volver al inicio» lleva a nuestra portada', () => {
  const join = readFileSync('web/join/index.html', 'utf8');
  assert.doesNotMatch(join, /padel_social/);
  assert.doesNotMatch(readFileSync('netlify/functions/alta.mjs', 'utf8'), /padel_social/);
  assert.match(join, /<a class="home" id="home" href="\/"/);
});

test('la lista de países del torneo es la del alta: mismos países y los mismos más comunes arriba', () => {
  const join = readFileSync('web/join/index.html', 'utf8'), torneo = readFileSync('web/tournaments/index.html', 'utf8');
  const isoAlta = join.match(/const DIAL_RAW = "([^"]+)"/)[1].split(',').map((x) => x.split(':')[0]);
  const isoTorneo = torneo.match(/const ISO = "([^"]+)"/)[1].split(' ');
  assert.deepEqual([...isoTorneo].sort(), [...isoAlta].sort());
  assert.equal(torneo.match(/const PIN = (\[[^\]]+\])/)[1], join.match(/const PIN = (\[[^\]]+\])/)[1]);
});

test('/join usa la cabecera y el menú compartidos, tiene <main> y ya no lleva logo ni idioma propios', () => {
  const join = readFileSync('web/join/index.html', 'utf8');
  assert.match(join, /href="\/assets\/nav\.css"/);
  assert.match(join, /src="\/assets\/site\.js"/);
  assert.match(join, /<main class="wrap">/);
  assert.doesNotMatch(join, /logoTop|<header class="top">/);
  assert.match(join, /ti:lang/);
});

test('los estilos compartidos llevan prefijo propio para no chocar con las clases de /join', () => {
  const nav = readFileSync('web/assets/nav.css', 'utf8');
  assert.doesNotMatch(nav, /(^|\n)\.(btn|brand|lang)\b/);
  assert.match(nav, /\.nbtn\{/); assert.match(nav, /\.nav-brand\b/); assert.match(nav, /\.nav-lang\b/);
});

test('las páginas legales existen, en inglés y en español, completas y sin huecos por rellenar', () => {
  for (const [ruta, secciones] of [['web/privacy/index.html', 9], ['web/disclaimer/index.html', 0]]) {
    const h = readFileSync(ruta, 'utf8');
    assert.equal((h.match(/<article lang="en">/g) || []).length, 1, ruta);
    assert.equal((h.match(/<article lang="es">/g) || []).length, 1, ruta);
    assert.doesNotMatch(h, /\[[A-ZÁÉÍÓÚ ]{3,}\]|\{EMAIL\}|Borrador|Draft/, `${ruta}: quedan huecos o etiquetas de borrador`);
    if (secciones) assert.equal((h.match(/<h2>/g) || []).length, secciones * 2, ruta);
  }
  const priv = readFileSync('web/privacy/index.html', 'utf8');
  assert.match(priv, /Jaime Pérez Esteban, C\/ Santiago de Compostela 92, 28035 Madrid/);
  assert.match(priv, /hasta 12 meses después de tu última participación/);
  assert.match(priv, /until 12 months after your last participation/);
  assert.match(priv, /mailto:jaimeperez@tennisinsane\.com/);
  assert.doesNotMatch(priv, /NIF|tax ID/);
  const desc = readFileSync('web/disclaimer/index.html', 'utf8');
  assert.equal((desc.match(/<li>/g) || []).length, 10);   // 5 puntos por idioma
});

test('/join y /tournaments enlazan la política y el descargo en inglés y en español y exigen las tres aceptaciones', () => {
  for (const f of ['web/join/index.html', 'web/tournaments/index.html']) {
    const h = readFileSync(f, 'utf8');
    assert.equal((h.match(/href=\\?"\/privacy\\?"/g) || []).length >= 2, true, `${f}: enlace a /privacy en los dos idiomas`);
    assert.equal((h.match(/href=\\?"\/disclaimer\\?"/g) || []).length >= 2, true, `${f}: enlace a /disclaimer en los dos idiomas`);
    assert.doesNotMatch(h, /pending legal review|pendiente de revisión|Pendiente de revisión|Pending review/, f);
  }
  const join = readFileSync('web/join/index.html', 'utf8');
  assert.match(join, /consent_descargo: true/);
  assert.match(join, /TERMS_VERSION = '2026-11-v1'/);
  const torneo = readFileSync('web/tournaments/index.html', 'utf8');
  assert.match(torneo, /descargo: true, imagen: true, privacidad: true/);
});

test('el texto aceptado queda archivado por versión y las rutas existen', () => {
  const md = readFileSync('docs/consentimientos/2026-11-v1.md', 'utf8');
  assert.match(md, /Política de privacidad \(Español\)/);
  assert.match(md, /Participation Disclaimer|Descargo de participación/);
  for (const s of ['privacy', 'disclaimer']) assert.match(toml, new RegExp(`from = "/${s}"\\s+to = "/${s}/index.html"`));
  assert.match(readFileSync('supabase/legal.sql', 'utf8'), /consent_descargo/);
});

test('las tipografías están alojadas en el sitio: ninguna página ni la CSP llaman a Google Fonts', () => {
  const nav = readFileSync('web/assets/nav.css', 'utf8');
  for (const f of ['bricolage-grotesque-wght', 'dm-sans-400', 'dm-sans-500', 'dm-sans-600', 'dm-sans-700']) {
    assert.ok(existsSync(`web/assets/fonts/${f}.woff2`), f);
    assert.ok(nav.includes(`/assets/fonts/${f}.woff2`), f);
  }
  assert.ok(existsSync('web/assets/fonts/LICENSE.txt'));
  const paginas = ['index', 'about', 'contact', 'lessons', 'social-events', 'privacy', 'disclaimer', 'join', 'tournaments'];
  for (const p of paginas) {
    const h = readFileSync(p === 'index' ? 'web/index.html' : `web/${p}/index.html`, 'utf8');
    assert.doesNotMatch(h, /fonts\.(googleapis|gstatic)\.com/, p);
  }
  assert.doesNotMatch(readFileSync('netlify.toml', 'utf8'), /fonts\.(googleapis|gstatic)\.com/);
});
