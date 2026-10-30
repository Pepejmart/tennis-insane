/* web/assets/site.js · cabecera, menú, pie e idioma compartidos. Un solo sitio donde editar el menú.
   Se usa en la portada, las páginas en construcción y /tournaments. El idioma elegido se guarda en
   localStorage («ti_lang») y se avisa a la página con el evento «ti:lang». */
(function () {
  var IG = 'https://www.instagram.com/tennisinsane/';
  var SHOP = 'https://tennisinsane.com/';
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
  var q = new URLSearchParams(location.search).get('lang');
  if (q === 'es' || q === 'en') lang = q;
  if (lang !== 'es' && lang !== 'en') lang = String(navigator.language || 'en').toLowerCase().indexOf('es') === 0 ? 'es' : 'en';
  document.documentElement.lang = lang;   // antes de pintar: sin parpadeo de idioma
  window.TI_LANG = lang;                  // para las páginas que traducen por su cuenta

  function t(en, es) { return '<span lang="en">' + en + '</span><span lang="es">' + es + '</span>'; }
  var NEWTAB = '<span class="sr">' + t(' (opens in a new tab)', ' (se abre en una pestaña nueva)') + '</span>';

  document.addEventListener('DOMContentLoaded', function () {
    var items = NAV.map(function (n) {
      var ext = n.external ? ' target="_blank" rel="noopener noreferrer"' : '';
      var extra = n.external ? ' <span class="ext" aria-hidden="true">↗</span>' + NEWTAB : '';
      return '<li><a href="' + n.href + '"' + ext + '>' + t(n.en, n.es) + extra + '</a></li>';
    }).join('');

    var header = document.createElement('header');
    header.className = 'site-header';
    header.innerHTML =
      '<div class="hdr-inner">' +
        '<a class="nav-brand" href="/" aria-label="Tennis Insane"><img src="/assets/logo.webp" width="640" height="357" alt="Tennis Insane"></a>' +
        '<button type="button" class="menu-btn" aria-expanded="false" aria-controls="menu">' +
          '<span class="bars" aria-hidden="true"><i></i><i></i></span>' +
          '<span class="when-closed">' + t('Menu', 'Menú') + '</span><span class="when-open">' + t('Close', 'Cerrar') + '</span>' +
        '</button>' +
      '</div>';

    var menu = document.createElement('aside');
    menu.id = 'menu'; menu.className = 'menu'; menu.hidden = true; menu.setAttribute('aria-label', 'Menu');
    menu.innerHTML =
      '<div class="menu-inner">' +
      '<div class="nav-lang" role="group" aria-label="Idioma / Language"><button type="button" data-l="en">EN</button><button type="button" data-l="es">ES</button></div>' +
      '<nav aria-label="Menu"><ul>' + items + '</ul></nav>' +
      '<div class="menu-cta">' +
        '<a class="nbtn nbtn-primary" href="/join">' + t('Join the WhatsApp community', 'Únete a la comunidad de WhatsApp') + '</a>' +
        '<a class="nbtn nbtn-ghost" href="' + IG + '" target="_blank" rel="noopener noreferrer">' + t('Follow us on Instagram', 'Síguenos en Instagram') + NEWTAB + '</a>' +
      '</div></div>';

    var footer = document.createElement('footer');
    footer.className = 'site-footer';
    footer.innerHTML =
      '<div class="ftr-inner"><span>© ' + new Date().getFullYear() + ' Tennis Insane · Madrid</span>' +
      '<nav aria-label="Footer"><a href="' + IG + '" target="_blank" rel="noopener noreferrer">Instagram' + NEWTAB + '</a>' +
      '<a href="/join">WhatsApp</a><a href="/contact">' + t('Contact', 'Contacto') + '</a></nav></div>';

    var backdrop = document.createElement('div');
    backdrop.className = 'menu-backdrop'; backdrop.hidden = true;
    document.body.prepend(backdrop);
    document.body.prepend(menu);
    document.body.prepend(header);
    if (!document.body.hasAttribute('data-no-footer')) document.body.appendChild(footer);

    var btn = header.querySelector('.menu-btn'), brand = header.querySelector('.nav-brand');
    function setMenu(open) {
      menu.hidden = !open; backdrop.hidden = !open; btn.setAttribute('aria-expanded', String(open));
      document.body.classList.toggle('menu-open', open);
      // Mientras el menú está abierto, el resto de la página no recibe foco ni se lee.
      Array.prototype.forEach.call(document.querySelectorAll('main, .site-footer'), function (el) { el.inert = open; });
      if (open) { var a = menu.querySelector('nav a'); if (a) a.focus(); } else { btn.focus(); }
    }
    btn.addEventListener('click', function () { setMenu(menu.hidden); });
    menu.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
    backdrop.addEventListener('click', function () { setMenu(false); });
    document.addEventListener('keydown', function (e) {
      if (menu.hidden) return;
      if (e.key === 'Escape') { setMenu(false); return; }
      if (e.key !== 'Tab') return;
      // Foco circular: logo → botón → menú → vuelta al logo.
      var foc = [brand, btn].concat(Array.prototype.slice.call(menu.querySelectorAll('a, button')));
      var first = foc[0], last = foc[foc.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    function paintLang() {
      document.documentElement.lang = lang; window.TI_LANG = lang;
      document.querySelectorAll('[data-l]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-l') === lang)); });
    }
    document.querySelectorAll('[data-l]').forEach(function (b) {
      b.addEventListener('click', function () {
        lang = b.getAttribute('data-l'); save(lang); paintLang();
        document.dispatchEvent(new CustomEvent('ti:lang', { detail: lang }));
      });
    });
    paintLang();
  });
})();
