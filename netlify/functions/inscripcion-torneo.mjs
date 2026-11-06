// POST /api/inscripcion-torneo · inscribe y devuelve el enlace de pago de Stripe Checkout.
// La plaza solo se ocupa con un pago en curso (retención 32 min) o pagado; el resto, reserva.
import { json, validarInscripcion, referenciaPara, supabase, stripe } from '../lib/torneo.mjs';

export const config = {
  path: '/api/inscripcion-torneo',
  // Mismo límite por IP que el alta (ver docs/despliegue.md, sección 5).
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};

const COMPROMISO_VERSION = () => process.env.COMPROMISO_VERSION || 'v0-borrador';
const PRIVACIDAD_VERSION = () => process.env.PRIVACIDAD_VERSION || '2026-11-v1';   // textos de /privacy y /disclaimer (docs/consentimientos)
const DESCARGO_VERSION = () => process.env.DESCARGO_VERSION || '2026-11-v1';

async function verificarTurnstile(token, secreto) {
  if (!secreto) return true; // aún sin Turnstile configurado
  if (!token) return false;
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret: secreto, response: token }).toString(),
  });
  return (await r.json())?.success === true;
}

/** Reutiliza la sesión de Checkout abierta o crea una nueva (caducidad 31 min, retención alineada). */
async function enlaceDePago({ sb, st, env, slug, referencia, datos }) {
  const [torneo] = await sb.select('torneos', `slug=eq.${encodeURIComponent(slug)}&select=nombre,precio_centimos`);
  const [fila] = await sb.select('inscripciones_torneo', `referencia=eq.${encodeURIComponent(referencia)}&select=id,stripe_session_id`);
  if (fila?.stripe_session_id) {
    try {
      const s = await st.obtenerSesion(fila.stripe_session_id);
      if (s.status === 'open' && s.url) return s.url;
    } catch { /* si no se puede leer, se crea otra */ }
  }
  const sitio = (env.SITE_URL || env.URL || '').replace(/\/$/, '');
  const expira = Math.floor(Date.now() / 1000) + 31 * 60; // Stripe exige entre 30 min y 24 h
  const sesion = await st.crearSesion({
    mode: 'payment',
    locale: datos.idioma === 'en' ? 'en' : 'es',
    customer_email: datos.email,
    client_reference_id: referencia,
    expires_at: String(expira),
    success_url: `${sitio}/tournaments/?pago=ok&ref=${referencia}`,
    cancel_url: `${sitio}/tournaments/?pago=cancelado&ref=${referencia}`,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'eur',
    'line_items[0][price_data][unit_amount]': String(torneo.precio_centimos),
    'line_items[0][price_data][product_data][name]': `${torneo.nombre} · Tennis Insane`,
    'metadata[referencia]': referencia,
    'metadata[torneo]': slug,
    'payment_intent_data[metadata][referencia]': referencia,
  });
  // La retención de plaza dura lo que la sesión (+1 min de margen).
  await sb.patch('inscripciones_torneo', `referencia=eq.${encodeURIComponent(referencia)}`, {
    stripe_session_id: sesion.id,
    hold_hasta: new Date((expira + 60) * 1000).toISOString(),
  });
  return sesion.url;
}

export default async function handler(req) {
  if (req.method !== 'POST') return json(405, { ok: false, error: 'metodo' });
  const env = process.env;

  let cuerpo;
  try {
    const bruto = await req.text();
    if (bruto.length > 10_000) return json(413, { ok: false, error: 'tamano' });
    cuerpo = JSON.parse(bruto);
  } catch { return json(400, { ok: false, error: 'json' }); }

  if (typeof cuerpo.website === 'string' && cuerpo.website.trim() !== '') return json(200, { ok: true, estado: 'reserva' }); // honeypot: no hace nada
  if (!(await verificarTurnstile(cuerpo.turnstile, env.TURNSTILE_SECRET))) {
    return json(400, { ok: false, error: 'captcha' });
  }

  const v = validarInscripcion(cuerpo);
  if (v.errores) return json(400, { ok: false, error: 'validacion', campos: v.errores });
  const d = v.datos;

  if (!env.REFERENCIA_SECRET) { console.error('falta REFERENCIA_SECRET'); return json(500, { ok: false, error: 'config' }); }
  const slug = env.TORNEO_SLUG || 'to2';
  const referencia = referenciaPara(env.REFERENCIA_SECRET, slug, d.email);
  const sb = supabase(env);

  let fila;
  try {
    [fila] = await sb.rpc('inscribir_torneo', {
      p_slug: slug, p_email: d.email, p_nombre: d.nombre, p_whatsapp: d.whatsapp, p_pais: d.pais,
      p_ntrp: d.ntrp, p_idioma: d.idioma, p_compromiso_version: COMPROMISO_VERSION(),
      p_privacidad_version: PRIVACIDAD_VERSION(), p_referencia: referencia,
      p_descargo_version: DESCARGO_VERSION(), p_imagen: true,
    });
  } catch (e) {
    if (String(e.message).includes('inscripcion_cerrada')) return json(409, { ok: false, error: 'cerrada' });
    console.error('inscribir_torneo', e.message); // sin datos personales en el log
    return json(500, { ok: false, error: 'servidor' });
  }

  const respuesta = { ok: true, estado: fila.r_estado, referencia: fila.r_referencia };
  if (fila.r_estado === 'pendiente_pago') {
    try {
      respuesta.checkoutUrl = await enlaceDePago({ sb, st: stripe(env), env, slug, referencia: fila.r_referencia, datos: d });
    } catch (e) {
      console.error('stripe', e.message);
      return json(502, { ok: false, error: 'pago', referencia: fila.r_referencia });
    }
  }
  return json(200, respuesta);
}
