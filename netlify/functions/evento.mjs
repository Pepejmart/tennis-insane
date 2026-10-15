// POST /api/evento  ·  evento anónimo de paso (sin cookies, sin IP). Siempre responde 204.
const TIPOS = ['step_view', 'step_complete', 'submit_ok'];

export default async (req) => {
  const done = () => new Response(null, { status: 204 });
  if (req.method !== 'POST') return done();
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: KEY } = process.env;
  if (!SUPABASE_URL || !KEY) return done();
  let e;
  try { e = JSON.parse(await req.text()); } catch { return done(); }
  const paso = Number(e?.step);
  const sid = typeof e?.sid === 'string' ? e.sid.slice(0, 16) : '';
  if (!sid || !TIPOS.includes(e?.type) || !Number.isInteger(paso) || paso < 1 || paso > 5) return done();
  const row = {
    sid, tipo: e.type, paso,
    idioma: ['es', 'en'].includes(e.lang) ? e.lang : null,
    utm_source: typeof e.utm_source === 'string' ? e.utm_source.slice(0, 100) : null
  };
  await fetch(`${SUPABASE_URL}/rest/v1/alta_eventos`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'content-type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(row)
  }).catch(() => {});
  return done();
};

export const config = {
  path: '/api/evento',
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'] }
};
