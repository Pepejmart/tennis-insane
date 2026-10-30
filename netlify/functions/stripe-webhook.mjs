// POST /api/stripe-webhook · marca «pagado» al completarse el pago y libera la plaza si caduca.
// Eventos a activar en Stripe: checkout.session.completed, checkout.session.async_payment_succeeded,
// checkout.session.expired.
import { json, verificarFirmaStripe, supabase } from '../lib/torneo.mjs';

export const config = { path: '/api/stripe-webhook' };

export default async function handler(req) {
  if (req.method !== 'POST') return json(405, { ok: false });
  const env = process.env;
  const bruto = await req.text(); // cuerpo sin tocar: la firma se calcula sobre él
  if (!verificarFirmaStripe(bruto, req.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET)) {
    return json(400, { ok: false, error: 'firma' });
  }

  let evento;
  try { evento = JSON.parse(bruto); } catch { return json(400, { ok: false }); }
  const s = evento?.data?.object;
  const referencia = s?.client_reference_id || s?.metadata?.referencia;
  if (!referencia) return json(200, { ok: true, ignorado: true });

  const sb = supabase(env);
  const filtro = `referencia=eq.${encodeURIComponent(referencia)}`;
  try {
    if (evento.type === 'checkout.session.completed' || evento.type === 'checkout.session.async_payment_succeeded') {
      if (s.payment_status !== 'paid') return json(200, { ok: true, esperando: true });
      const [fila] = await sb.select('inscripciones_torneo', `${filtro}&select=id,estado,stripe_payment_intent,notas`);
      if (!fila) { console.error('pago sin inscripción', referencia); return json(200, { ok: true }); }
      const pi = typeof s.payment_intent === 'string' ? s.payment_intent : null;
      if (fila.estado === 'pagado') {
        if (pi && fila.stripe_payment_intent && pi !== fila.stripe_payment_intent) {
          const aviso = `PAGO DUPLICADO ${pi}`;
          await sb.patch('inscripciones_torneo', filtro, { notas: [fila.notas, aviso].filter(Boolean).join(' | ') });
        }
        return json(200, { ok: true }); // idempotente
      }
      await sb.patch('inscripciones_torneo', filtro, {
        estado: 'pagado', metodo_pago: 'stripe', importe_centimos: s.amount_total ?? null,
        stripe_session_id: s.id, stripe_payment_intent: pi, pagado_at: new Date().toISOString(), hold_hasta: null,
      });
    } else if (evento.type === 'checkout.session.expired') {
      // Libera la plaza al momento (solo si seguía pendiente de pago).
      await sb.patch('inscripciones_torneo', `${filtro}&estado=eq.pendiente_pago`, { hold_hasta: null });
    }
  } catch (e) {
    console.error('webhook', evento.type, e.message);
    return json(500, { ok: false }); // Stripe reintenta
  }
  return json(200, { ok: true });
}
