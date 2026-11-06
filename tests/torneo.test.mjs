// node --test · datos ficticios (@example.test), sin red: fetch se sustituye por un simulador.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { validarInscripcion, referenciaPara, verificarFirmaStripe, contarOcupadas, supabase } from '../netlify/lib/torneo.mjs';
import inscripcion from '../netlify/functions/inscripcion-torneo.mjs';
import webhook from '../netlify/functions/stripe-webhook.mjs';
import info from '../netlify/functions/torneo-info.mjs';

Object.assign(process.env, {
  SUPABASE_URL: 'https://x.example.test', SUPABASE_SERVICE_ROLE_KEY: 'k-test',
  STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_test', REFERENCIA_SECRET: 'ref-secreto',
  SITE_URL: 'https://app.example.test', TORNEO_SLUG: 'to2',
});
delete process.env.TURNSTILE_SECRET;

const valido = {
  email: ' Ana@Example.test ', nombre: 'Ana  Prueba', whatsapp: '+34 600123456', pais: 'es',
  ntrp: 3.5, idioma: 'es', compromiso: true, descargo: true, imagen: true, privacidad: true,
};

/** Simulador de fetch: rutas = [[regex sobre "METODO url", (url, opts) => cuerpo | {status, cuerpo}]] */
function simular(rutas) {
  const llamadas = [];
  globalThis.fetch = async (url, opts = {}) => {
    const clave = `${opts.method || 'GET'} ${url}`;
    llamadas.push({ url: String(url), metodo: opts.method || 'GET', cuerpo: opts.body });
    for (const [re, fn] of rutas) {
      if (re.test(clave)) {
        const r = await fn(String(url), opts);
        const { status = 200, cuerpo } = r && r.cuerpo !== undefined ? r : { cuerpo: r };
        return new Response(JSON.stringify(cuerpo), { status });
      }
    }
    throw new Error(`sin ruta simulada: ${clave}`);
  };
  return llamadas;
}
const post = (cuerpo) => new Request('https://x.example.test/api/inscripcion-torneo', { method: 'POST', body: JSON.stringify(cuerpo) });
const firmar = (bruto, secreto = 'whsec_test', t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${createHmac('sha256', secreto).update(`${t}.${bruto}`).digest('hex')}`;

test('validación: normaliza y rechaza', () => {
  const ok = validarInscripcion(valido);
  assert.equal(ok.datos.email, 'ana@example.test');
  assert.equal(ok.datos.nombre, 'Ana Prueba');
  assert.equal(ok.datos.whatsapp, '+34600123456');
  assert.equal(ok.datos.pais, 'ES');
  assert.equal(validarInscripcion({ ...valido, ntrp: null }).datos.ntrp, null);
  assert.deepEqual(validarInscripcion({ ...valido, email: 'mal', nombre: 'Ana', ntrp: 7, compromiso: false }).errores.sort(),
    ['compromiso', 'email', 'nombre', 'ntrp']);
});

test('referencia: estable y con el formato de la tabla', () => {
  const a = referenciaPara('s', 'to2', 'ana@example.test');
  assert.equal(a, referenciaPara('s', 'to2', 'ana@example.test'));
  assert.notEqual(a, referenciaPara('s', 'to2', 'otra@example.test'));
  assert.match(a, /^TI-TO2-[A-Z0-9]{5}$/);
});

test('firma de Stripe: válida, manipulada y caducada', () => {
  const bruto = '{"a":1}';
  assert.equal(verificarFirmaStripe(bruto, firmar(bruto), 'whsec_test'), true);
  assert.equal(verificarFirmaStripe(bruto + ' ', firmar(bruto), 'whsec_test'), false);
  assert.equal(verificarFirmaStripe(bruto, firmar(bruto, 'otro'), 'whsec_test'), false);
  assert.equal(verificarFirmaStripe(bruto, firmar(bruto, 'whsec_test', 1000), 'whsec_test'), false);
  assert.equal(verificarFirmaStripe(bruto, undefined, 'whsec_test'), false);
});

test('Supabase: la clave nueva solo va en apikey; la antigua también como Bearer', async () => {
  let cab;
  globalThis.fetch = async (_u, o) => { cab = o.headers; return new Response('[]'); };
  await supabase({ SUPABASE_URL: 'https://x.example.test', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test' }).select('torneos', 'a=b');
  assert.equal(cab.apikey, 'sb_secret_test'); assert.equal(cab.Authorization, undefined);
  await supabase({ SUPABASE_URL: 'https://x.example.test', SUPABASE_SERVICE_ROLE_KEY: 'eyJ.test' }).select('torneos', 'a=b');
  assert.equal(cab.Authorization, 'Bearer eyJ.test');
});

test('plazas ocupadas: pagadas + retenciones vigentes', () => {
  const f = Date.now();
  assert.equal(contarOcupadas([
    { estado: 'pagado' }, { estado: 'pendiente_pago', hold_hasta: new Date(f + 60000).toISOString() },
    { estado: 'pendiente_pago', hold_hasta: new Date(f - 60000).toISOString() }, { estado: 'reserva' },
  ], f), 2);
});

test('inscripción nueva con plaza → devuelve enlace de Stripe y retiene hasta la caducidad', async () => {
  const llamadas = simular([
    [/rpc\/inscribir_torneo/, () => [{ r_estado: 'pendiente_pago', r_referencia: 'TI-TO2-ABCDE', r_nuevo: true, r_hold_hasta: null }]],
    [/GET .*\/torneos\?/, () => [{ nombre: 'Torneo de Invierno', precio_centimos: 2200 }]],
    [/GET .*inscripciones_torneo\?/, () => [{ id: 'i1', stripe_session_id: null }]],
    [/POST https:\/\/api\.stripe\.com\/v1\/checkout\/sessions/, () => ({ id: 'cs_test_1', url: 'https://checkout.stripe.test/c/1' })],
    [/PATCH .*inscripciones_torneo/, () => [{}]],
  ]);
  const r = await inscripcion(post(valido));
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.estado, 'pendiente_pago');
  assert.equal(j.checkoutUrl, 'https://checkout.stripe.test/c/1');
  const stripeLlamada = llamadas.find((l) => l.url.includes('api.stripe.com'));
  const p = new URLSearchParams(stripeLlamada.cuerpo);
  assert.equal(p.get('line_items[0][price_data][unit_amount]'), '2200');
  assert.equal(p.get('customer_email'), 'ana@example.test');
  assert.equal(p.get('client_reference_id'), j.referencia);
  const expira = Number(p.get('expires_at')) - Date.now() / 1000;
  assert.ok(expira >= 30 * 60 && expira <= 32 * 60, 'caducidad entre 30 y 32 min');
  const rpc = JSON.parse(llamadas.find((l) => l.url.includes('rpc/inscribir_torneo')).cuerpo);
  assert.equal(rpc.p_email, 'ana@example.test');
  assert.match(rpc.p_referencia, /^TI-TO2-[A-Z0-9]{5}$/);
  assert.ok(llamadas.some((l) => l.metodo === 'PATCH' && l.cuerpo.includes('cs_test_1')), 'guarda la sesión y alarga la retención');
});

test('reserva: no se llama a Stripe', async () => {
  const llamadas = simular([[/rpc\/inscribir_torneo/, () => [{ r_estado: 'reserva', r_referencia: 'TI-TO2-ZZZZZ', r_nuevo: true }]]]);
  const j = await (await inscripcion(post(valido))).json();
  assert.equal(j.estado, 'reserva');
  assert.equal(j.checkoutUrl, undefined);
  assert.equal(llamadas.some((l) => l.url.includes('stripe')), false);
});

test('repetición con sesión abierta: reutiliza el enlace, no crea otra sesión', async () => {
  const llamadas = simular([
    [/rpc\/inscribir_torneo/, () => [{ r_estado: 'pendiente_pago', r_referencia: 'TI-TO2-ABCDE', r_nuevo: false }]],
    [/GET .*\/torneos\?/, () => [{ nombre: 'Torneo de Invierno', precio_centimos: 2200 }]],
    [/GET .*inscripciones_torneo\?/, () => [{ id: 'i1', stripe_session_id: 'cs_test_1' }]],
    [/GET https:\/\/api\.stripe\.com\/v1\/checkout\/sessions\/cs_test_1/, () => ({ id: 'cs_test_1', status: 'open', url: 'https://checkout.stripe.test/c/1' })],
  ]);
  const j = await (await inscripcion(post(valido))).json();
  assert.equal(j.checkoutUrl, 'https://checkout.stripe.test/c/1');
  assert.equal(llamadas.some((l) => l.metodo === 'POST' && l.url.includes('api.stripe.com')), false);
});

test('inscripción cerrada, validación, honeypot y método', async () => {
  simular([[/rpc\/inscribir_torneo/, () => ({ status: 400, cuerpo: { message: 'inscripcion_cerrada' } })]]);
  assert.equal((await inscripcion(post(valido))).status, 409);
  assert.equal((await inscripcion(post({ ...valido, email: 'mal' }))).status, 400);
  const llamadas = simular([]);
  assert.equal((await inscripcion(post({ ...valido, website: 'spam' }))).status, 200);
  assert.equal(llamadas.length, 0, 'el honeypot no toca la base');
  assert.equal((await inscripcion(new Request('https://x.example.test/', { method: 'GET' }))).status, 405);
});

test('si Stripe falla: 502 y la referencia queda para reintentar', async () => {
  simular([
    [/rpc\/inscribir_torneo/, () => [{ r_estado: 'pendiente_pago', r_referencia: 'TI-TO2-ABCDE', r_nuevo: true }]],
    [/GET .*\/torneos\?/, () => [{ nombre: 'T', precio_centimos: 2200 }]],
    [/GET .*inscripciones_torneo\?/, () => [{ id: 'i1', stripe_session_id: null }]],
    [/POST https:\/\/api\.stripe\.com/, () => ({ status: 500, cuerpo: { error: { message: 'boom' } } })],
  ]);
  const r = await inscripcion(post(valido));
  assert.equal(r.status, 502);
  assert.equal((await r.json()).referencia, 'TI-TO2-ABCDE');
});

const evento = (tipo, extra = {}) => JSON.stringify({
  type: tipo, data: { object: { id: 'cs_test_1', client_reference_id: 'TI-TO2-ABCDE', payment_status: 'paid',
    payment_intent: 'pi_1', amount_total: 2200, ...extra } },
});
const hook = (bruto, firma = firmar(bruto)) =>
  webhook(new Request('https://x.example.test/api/stripe-webhook', { method: 'POST', body: bruto, headers: { 'stripe-signature': firma } }));

test('webhook: pago completado → pagado con importe y sin retención', async () => {
  const llamadas = simular([
    [/GET .*inscripciones_torneo\?/, () => [{ id: 'i1', estado: 'pendiente_pago', stripe_payment_intent: null, notas: null }]],
    [/PATCH .*inscripciones_torneo/, () => [{}]],
  ]);
  const r = await hook(evento('checkout.session.completed'));
  assert.equal(r.status, 200);
  const patch = JSON.parse(llamadas.find((l) => l.metodo === 'PATCH').cuerpo);
  assert.equal(patch.estado, 'pagado');
  assert.equal(patch.metodo_pago, 'stripe');
  assert.equal(patch.importe_centimos, 2200);
  assert.equal(patch.hold_hasta, null);
});

test('webhook: firma incorrecta → 400 y no toca nada', async () => {
  const llamadas = simular([]);
  assert.equal((await hook(evento('checkout.session.completed'), 't=1,v1=00')).status, 400);
  assert.equal(llamadas.length, 0);
});

test('webhook: repetido es idempotente y un segundo pago distinto se anota', async () => {
  let llamadas = simular([[/GET .*inscripciones_torneo\?/, () => [{ id: 'i1', estado: 'pagado', stripe_payment_intent: 'pi_1', notas: null }]]]);
  assert.equal((await hook(evento('checkout.session.completed'))).status, 200);
  assert.equal(llamadas.some((l) => l.metodo === 'PATCH'), false);
  llamadas = simular([
    [/GET .*inscripciones_torneo\?/, () => [{ id: 'i1', estado: 'pagado', stripe_payment_intent: 'pi_1', notas: null }]],
    [/PATCH .*inscripciones_torneo/, () => [{}]],
  ]);
  await hook(evento('checkout.session.completed', { payment_intent: 'pi_2' }));
  assert.match(JSON.parse(llamadas.find((l) => l.metodo === 'PATCH').cuerpo).notas, /PAGO DUPLICADO pi_2/);
});

test('webhook: sesión caducada libera la plaza solo si seguía pendiente', async () => {
  const llamadas = simular([[/PATCH .*inscripciones_torneo/, () => [{}]]]);
  await hook(evento('checkout.session.expired', { payment_status: 'unpaid' }));
  const p = llamadas.find((l) => l.metodo === 'PATCH');
  assert.match(p.url, /estado=eq\.pendiente_pago/);
  assert.deepEqual(JSON.parse(p.cuerpo), { hold_hasta: null });
});

test('torneo-info: abierta, reserva y cerrada', async () => {
  const futuro = new Date(Date.now() + 864e5).toISOString(), pasado = new Date(Date.now() - 864e5).toISOString();
  const torneo = (o) => [{ id: 't1', nombre: 'Torneo de Invierno', estado: 'inscripcion', inscripcion_abre: pasado,
    inscripcion_cierra: futuro, precio_centimos: 2200, plazas_base: 2, plazas_max: 3, modo: 'MODO_24', ...o }];
  const get = () => new Request('https://x.example.test/api/torneo-info');
  simular([[/GET .*\/torneos\?/, () => torneo()], [/GET .*inscripciones_torneo\?/, () => [{ estado: 'pagado' }]]]);
  assert.equal((await (await info(get())).json()).estado, 'abierta');
  simular([[/GET .*\/torneos\?/, () => torneo()], [/GET .*inscripciones_torneo\?/, () => [{ estado: 'pagado' }, { estado: 'pagado' }]]]);
  assert.equal((await (await info(get())).json()).estado, 'reserva');
  simular([[/GET .*\/torneos\?/, () => torneo({ inscripcion_cierra: pasado })], [/GET .*inscripciones_torneo\?/, () => []]]);
  assert.equal((await (await info(get())).json()).estado, 'cerrada');
});

test('el torneo exige descargo, grabación y privacidad, además del compromiso', () => {
  assert.deepEqual(validarInscripcion({ ...valido, descargo: false, imagen: false, privacidad: false }).errores.sort(), ['descargo', 'imagen', 'privacidad']);
  assert.deepEqual(validarInscripcion({ ...valido, descargo: undefined }).errores, ['descargo']);
});

test('la inscripción guarda la versión del descargo y la aceptación de la grabación', async () => {
  const llamadas = simular([[/rpc\/inscribir_torneo/, () => [{ r_estado: 'reserva', r_referencia: 'TI-TO2-ABCDE', r_nuevo: true }]]]);
  await inscripcion(post(valido));
  const rpc = JSON.parse(llamadas.find((l) => l.url.includes('rpc/inscribir_torneo')).cuerpo);
  assert.equal(rpc.p_descargo_version, '2026-11-v1');
  assert.equal(rpc.p_imagen, true);
  assert.equal(rpc.p_privacidad_version, '2026-11-v1');
});
