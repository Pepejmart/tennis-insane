// POST /api/alta  ·  valida, comprueba Turnstile e inserta en Supabase con la clave de servidor.
// Variables de entorno (Netlify): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TURNSTILE_SECRET, WHATSAPP_COMMUNITY_URL

const GENEROS = ['Hombre / Male', 'Mujer / Female', 'Otro / Other', 'Prefiero no decirlo / Prefer not to say'];
const NIVELES = ['Iniciación / Beginner', 'Intermedio 2.5-3.0', 'Intermedio-alto 3.5', 'Avanzado 4.0+', 'No estoy seguro / Not sure'];
const IDIOMAS = ['Español', 'English', 'Ambos / Both'];
const CANALES = ['Instagram', 'Meetup', 'Web', 'Un amigo / Word of mouth', 'Otro / Other'];
const INTERESES = ['tenis_social', 'padel_social', 'torneos', 'clases', 'buscar_partido', 'comunidad'];
const ZONAS = ['Centro', 'Arganzuela', 'Retiro', 'Salamanca', 'Chamartín', 'Tetuán', 'Chamberí', 'Fuencarral-El Pardo',
  'Moncloa-Aravaca', 'Latina', 'Carabanchel', 'Usera', 'Puente de Vallecas', 'Moratalaz', 'Ciudad Lineal', 'Hortaleza',
  'Villaverde', 'Villa de Vallecas', 'Vicálvaro', 'San Blas-Canillejas', 'Barajas',
  'Otra zona / Fuera de Madrid / Other area / Outside Madrid', "No sé / I don't know"];

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const optStr = (v, max) => { const x = str(v, max); return x || null; };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function adultBirth(iso, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d || y < 1900) return false;
  let age = now.getUTCFullYear() - y;
  if (now < new Date(Date.UTC(now.getUTCFullYear(), m - 1, d))) age--;
  return age >= 18 && age <= 100;
}

// Devuelve la fila lista para insertar, o null si algo no cuadra (el motivo no se detalla al cliente).
export function clean(b, now = new Date()) {
  if (!b || typeof b !== 'object') return null;
  const email = str(b.email, 254).toLowerCase();
  const nombre = str(b.nombre, 80), apellido = str(b.apellido, 80);
  const whatsapp = str(b.whatsapp, 20), pais = str(b.pais, 2).toUpperCase();
  const fecha = str(b.fecha_nacimiento, 10);
  const intereses = Array.isArray(b.intereses) ? [...new Set(b.intereses)].filter(x => INTERESES.includes(x)) : [];
  const zona = optStr(b.zona, 80), canal = optStr(b.canal, 40);
  if (!EMAIL_RE.test(email) || !nombre || !apellido) return null;
  if (!/^\+[1-9][0-9]{6,14}$/.test(whatsapp) || !/^[A-Z]{2}$/.test(pais)) return null;
  if (!adultBirth(fecha, now)) return null;
  if (!GENEROS.includes(b.genero) || !NIVELES.includes(b.nivel) || !IDIOMAS.includes(b.idioma_pref)) return null;
  if (zona && !ZONAS.includes(zona)) return null;
  if (canal && !CANALES.includes(canal)) return null;
  if (b.consent_privacidad !== true || b.consent_imagen !== true) return null;
  if (!['es', 'en'].includes(b.idioma_form)) return null;
  return {
    email, nombre, apellido, whatsapp, pais, fecha_nacimiento: fecha,
    genero: b.genero, nivel: b.nivel, idioma_pref: b.idioma_pref, zona, intereses, canal,
    consent_privacidad: true, consent_imagen: true, novedades: b.novedades === true,
    consent_version: str(b.consent_version, 40) || 'desconocida', idioma_form: b.idioma_form,
    utm_source: optStr(b.utm_source, 100), utm_medium: optStr(b.utm_medium, 100), utm_campaign: optStr(b.utm_campaign, 100)
  };
}

async function turnstileOk(secret, token) {
  if (!token || typeof token !== 'string') return false;
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret, response: token })
  });
  const j = await r.json().catch(() => ({}));
  return j.success === true;
}

export default async (req) => {
  if (req.method !== 'POST') return json({ ok: false }, 405);
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: KEY, TURNSTILE_SECRET, WHATSAPP_COMMUNITY_URL } = process.env;
  if (!SUPABASE_URL || !KEY || !WHATSAPP_COMMUNITY_URL) { console.error('alta: faltan variables de entorno'); return json({ ok: false }, 500); }

  let b;
  try { b = await req.json(); } catch { return json({ ok: false }, 400); }

  // Honeypot: un bot lo rellena. Respondemos "ok" pero sin enlace y sin guardar nada.
  if (b && typeof b.website === 'string' && b.website.trim() !== '') return json({ ok: true, joinUrl: null });

  if (TURNSTILE_SECRET && !(await turnstileOk(TURNSTILE_SECRET, b?.turnstile))) return json({ ok: false, error: 'captcha' }, 400);

  const row = clean(b);
  if (!row) return json({ ok: false, error: 'invalid' }, 400);

  // Clave nueva (sb_secret_…) solo va en apikey; la antigua service_role (JWT, empieza por eyJ) también como Bearer.
  const headers = { apikey: KEY, ...(KEY.startsWith('eyJ') ? { Authorization: `Bearer ${KEY}` } : {}), 'content-type': 'application/json', Prefer: 'return=minimal' };
  const ins = await fetch(`${SUPABASE_URL}/rest/v1/altas`, { method: 'POST', headers, body: JSON.stringify(row) });

  if (ins.status === 409) {
    // Email repetido: se conserva la fila original y el envío nuevo queda aparte. El cliente ve lo mismo.
    const dup = await fetch(`${SUPABASE_URL}/rest/v1/altas_intentos`, {
      method: 'POST', headers, body: JSON.stringify({ email: row.email, payload: row })
    });
    if (!dup.ok) console.error('alta: fallo al guardar intento', dup.status);
  } else if (!ins.ok) {
    console.error('alta: fallo al insertar', ins.status);   // sin datos personales en el log
    return json({ ok: false }, 500);
  }
  return json({ ok: true, joinUrl: WHATSAPP_COMMUNITY_URL });
};

export const config = {
  path: '/api/alta',
  // Límite de envíos por IP. Comprobar que el plan de Netlify lo admite (ver docs/despliegue.md).
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ['ip', 'domain'] }
};
