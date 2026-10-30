/* web/assets/site.js · cabecera, menú, pie e idioma compartidos. Un solo sitio donde editar el menú. */
(function () {
  var IG = 'https://www.instagram.com/tennisinsane/';
  var SHOP = 'https://tennisinsane.com/tennis-clothing/';
  var NAV = [
    { href: '/social-events', en: 'Social Tennis Events', es: 'Eventos de tenis social' },
    { href: '/tournaments',   en: 'Tournaments',          es: 'Torneos' },
    { href: '/lessons',       en: 'Lessons',              es: 'Clases' },
    { href: SHOP,             en: 'Shop',                 es: 'Tienda', external: true },
    { href: '/about',         en: 'About',                es: 'Sobre nosotros' },
    { href: '/contact',       en: 'Contact',              es: 'Contacto' }
  ];
  var KEY = 'ti_lang';
  function stored() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function save(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  var lang = stored();
  if (lang !== 'es' && lang !== 'en') lang = String(navigator.language || 'en').toLowerCase().indexOf('es') === 0 ? 'es' : 'en';
  document.documentElement.lang = lang;   // antes de pintar: sin parpadeo de idioma

  function t(en, es) { return '<span lang="en">' + en + '</span><span lang="es">' + es + '</span>'; }

  document.addEventListener('DOMContentLoaded', function () {
    var items = NAV.map(function (n) {
      var ext = n.external ? ' target="_blank" rel="noopener noreferrer"' : '';
      var arrow = n.external ? ' <span class="ext" aria-hidden="true">↗</span>' : '';
      return '<li><a href="' + n.href + '"' + ext + '>' + t(n.en, n.es) + arrow + '</a></li>';
    }).join('');

    var header = document.createElement('header');
    header.className = 'site-header';
    header.innerHTML =
      '<div class="wrap">' +
        '<a class="brand" href="/" aria-label="Tennis Insane"><img src="/assets/logo.webp" width="640" height="357" alt="Tennis Insane"></a>' +
        '<button type="button" class="menu-btn" aria-expanded="false" aria-controls="menu">' +
          '<span class="bars" aria-hidden="true"><i></i><i></i></span>' +
          '<span class="when-closed">' + t('Menu', 'Menú') + '</span><span class="when-open">' + t('Close', 'Cerrar') + '</span>' +
        '</button>' +
      '</div>';

    var menu = document.createElement('div');
    menu.id = 'menu'; menu.className = 'menu'; menu.hidden = true;
    menu.innerHTML =
      '<div class="wrap">' +
      '<div class="lang" role="group" aria-label="Idioma / Language"><button type="button" data-l="en">EN</button><button type="button" data-l="es">ES</button></div>' +
      '<nav aria-label="Menu"><ul>' + items + '</ul></nav>' +
      '<div class="menu-cta">' +
        '<a class="btn btn-primary" href="/join">' + t('Join the WhatsApp community', 'Únete a la comunidad de WhatsApp') + '</a>' +
        '<a class="btn btn-ghost" href="' + IG + '" target="_blank" rel="noopener noreferrer">' + t('Follow us on Instagram', 'Síguenos en Instagram') + '</a>' +
      '</div></div>';

    var footer = document.createElement('footer');
    footer.className = 'site-footer';
    footer.innerHTML =
      '<div class="wrap"><span>© ' + new Date().getFullYear() + ' Tennis Insane · Madrid</span>' +
      '<nav aria-label="Footer"><a href="' + IG + '" target="_blank" rel="noopener noreferrer">Instagram</a>' +
      '<a href="/join">WhatsApp</a><a href="/contact">' + t('Contact', 'Contacto') + '</a></nav></div>';

    document.body.prepend(menu);
    document.body.prepend(header);
    if (!document.body.hasAttribute('data-no-footer')) document.body.appendChild(footer);

    var btn = header.querySelector('.menu-btn');
    function setMenu(open) {
      menu.hidden = !open; btn.setAttribute('aria-expanded', String(open));
      document.body.classList.toggle('menu-open', open);
      if (open) { var a = menu.querySelector('a'); if (a) a.focus(); } else { btn.focus(); }
    }
    btn.addEventListener('click', function () { setMenu(menu.hidden); });
    menu.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !menu.hidden) setMenu(false); });

    function paintLang() {
      document.documentElement.lang = lang;
      document.querySelectorAll('[data-l]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-l') === lang)); });
    }
    document.querySelectorAll('[data-l]').forEach(function (b) {
      b.addEventListener('click', function () { lang = b.getAttribute('data-l'); save(lang); paintLang(); });
    });
    paintLang();
  });
})();
