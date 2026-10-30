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
  ['Shop', 'https://tennisinsane.com/tennis-clothing/'],
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
  assert.equal((inicio.match(/class="btn-pill"/g) || []).length, 2);
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
