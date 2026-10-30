// netlify/lib/torneo.mjs · utilidades del Torneo de Invierno (inscripción + Stripe)
// Sin dependencias: Supabase por REST y Stripe por REST. Nada de claves en el código.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin 0/O/1/I/L
const NTRP_VALIDOS = new Set([2, 2.5, 3, 3.5, 4, 4.5, 5]);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

export const normalizarEmail = (e) => String(e ?? '').trim().toLowerCase().replace(/\s+/g, '');

/** Valida y normaliza el cuerpo de la inscripción. Devuelve { datos } o { errores }. */
export function validarInscripcion(b = {}) {
  const errores = [];
  const email = normalizarEmail(b.email);
  if (!EMAIL.test(email) || email.length > 120) errores.push('email');
  const nombre = String(b.nombre ?? '').trim().replace(/\s+/g, ' ');
  if (nombre.length < 3 || nombre.length > 80 || !nombre.includes(' ')) errores.push('nombre');
  const whatsapp = String(b.whatsapp ?? '').replace(/[\s-]/g, '');
  if (!/^\+[1-9][0-9]{6,14}$/.test(whatsapp)) errores.push('whatsapp');
  const pais = String(b.pais ?? '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(pais)) errores.push('pais');
  let ntrp = null; // null = «no lo sé»
  if (b.ntrp !== null && b.ntrp !== undefined) {
    const n = Number(b.ntrp);
    if (NTRP_VALIDOS.has(n)) ntrp = n; else errores.push('ntrp');
  }
  if (b.compromiso !== true) errores.push('compromiso');
  if (b.privacidad !== true) errores.push('privacidad');
  if (errores.length) return { errores };
  return { datos: { email, nombre, whatsapp, pais, ntrp, idioma: b.idioma === 'en' ? 'en' : 'es' } };
}

/** Referencia estable por torneo+email (HMAC): una repetición devuelve la misma sin consultar nada. */
export function referenciaPara(secreto, slug, email) {
  const h = createHmac('sha256', secreto).update(`${slug}|${email}`).digest();
  let codigo = '';
  for (let i = 0; i < 5; i++) codigo += ALFABETO[h[i] % ALFABETO.length];
  return `TI-${slug.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 6)}-${codigo}`;
}

/** Verifica la cabecera Stripe-Signature (esquema v1, HMAC-SHA256 de `${t}.${cuerpo}`). */
export function verificarFirmaStripe(cuerpo, cabecera, secreto, ahora = Date.now() / 1000, tolerancia = 300) {
  if (!cabecera || !secreto) return false;
  const partes = cabecera.split(',').map((p) => p.split('='));
  const t = partes.find(([k]) => k === 't')?.[1];
  const firmas = partes.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !firmas.length || Math.abs(ahora - Number(t)) > tolerancia) return false;
  const esperada = Buffer.from(createHmac('sha256', secreto).update(`${t}.${cuerpo}`).digest('hex'));
  return firmas.some((f) => {
    const b = Buffer.from(f);
    return b.length === esperada.length && timingSafeEqual(b, esperada);
  });
}

/** Cliente mínimo de Supabase por REST con la clave secreta (solo existe en el servidor). */
export function supabase(env = process.env) {
  const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const clave = env.SUPABASE_SERVICE_ROLE_KEY;
  // Igual que alta.mjs: la clave nueva (sb_secret_…) solo va en apikey; la antigua service_role (JWT, eyJ…) también como Bearer.
  const cab = { apikey: clave, ...(String(clave).startsWith('eyJ') ? { Authorization: `Bearer ${clave}` } : {}), 'Content-Type': 'application/json' };
  async function llamar(url, opciones) {
    const r = await fetch(url, opciones);
    const texto = await r.text();
    let cuerpo; try { cuerpo = texto ? JSON.parse(texto) : null; } catch { cuerpo = texto; }
    if (!r.ok) throw Object.assign(new Error(cuerpo?.message || `supabase ${r.status}`), { status: r.status });
    return cuerpo;
  }
  return {
    rpc: (fn, args) => llamar(`${base}/rest/v1/rpc/${fn}`, { method: 'POST', headers: cab, body: JSON.stringify(args) }),
    select: (tabla, consulta) => llamar(`${base}/rest/v1/${tabla}?${consulta}`, { headers: cab }),
    patch: (tabla, consulta, datos) =>
      llamar(`${base}/rest/v1/${tabla}?${consulta}`, {
        method: 'PATCH', headers: { ...cab, Prefer: 'return=representation' }, body: JSON.stringify(datos),
      }),
  };
}

/** Cliente mínimo de Stripe por REST (Checkout Sessions). */
export function stripe(env = process.env) {
  async function llamar(metodo, ruta, params) {
    const r = await fetch(`https://api.stripe.com${ruta}`, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: params ? new URLSearchParams(params).toString() : undefined,
    });
    const cuerpo = await r.json();
    if (!r.ok) throw Object.assign(new Error(cuerpo?.error?.message || `stripe ${r.status}`), { status: r.status });
    return cuerpo;
  }
  return {
    crearSesion: (params) => llamar('POST', '/v1/checkout/sessions', params),
    obtenerSesion: (id) => llamar('GET', `/v1/checkout/sessions/${encodeURIComponent(id)}`),
  };
}

/** Plazas ocupadas = pagadas + pagos en curso con retención vigente. */
export function contarOcupadas(filas, ahora = Date.now()) {
  return filas.filter(
    (f) => f.estado === 'pagado' || (f.estado === 'pendiente_pago' && f.hold_hasta && Date.parse(f.hold_hasta) > ahora),
  ).length;
}
