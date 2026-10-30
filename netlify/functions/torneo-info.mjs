// GET /api/torneo-info · estado público de la inscripción (abierta / reserva / cerrada) y plazas.
import { json, supabase, contarOcupadas } from '../lib/torneo.mjs';

export const config = { path: '/api/torneo-info' };

export default async function handler(req) {
  if (req.method !== 'GET') return json(405, { ok: false });
  const env = process.env;
  const slug = env.TORNEO_SLUG || 'to2';
  const sb = supabase(env);
  try {
    const [t] = await sb.select('torneos',
      `slug=eq.${encodeURIComponent(slug)}&select=id,nombre,estado,inscripcion_abre,inscripcion_cierra,precio_centimos,plazas_base,plazas_max,modo`);
    if (!t) return json(404, { ok: false });
    const filas = await sb.select('inscripciones_torneo', `torneo_id=eq.${t.id}&select=estado,hold_hasta`);
    const cupo = t.modo === 'MODO_32' ? t.plazas_max : t.plazas_base;
    const ocupadas = contarOcupadas(filas);
    const ahora = Date.now();
    const enPlazo = t.estado === 'inscripcion' && ahora >= Date.parse(t.inscripcion_abre) && ahora <= Date.parse(t.inscripcion_cierra);
    const estado = !enPlazo ? 'cerrada' : ocupadas >= cupo ? 'reserva' : 'abierta';
    const r = json(200, { ok: true, estado, ocupadas, cupo, precio_centimos: t.precio_centimos, nombre: t.nombre });
    r.headers.set('Cache-Control', 'public, max-age=15');
    return r;
  } catch (e) {
    console.error('torneo-info', e.message);
    return json(500, { ok: false });
  }
}
