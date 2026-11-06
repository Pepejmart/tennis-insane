-- supabase/legal.sql · textos legales v1 (2026-11-v1): descargo de participación y grabación de imágenes
-- Aditivo y repetible. Ejecutar DESPUÉS de schema.sql y torneos.sql.
-- Compatible con la versión anterior de las funciones de Netlify: las columnas y parámetros nuevos
-- tienen valores por defecto, así que se puede aplicar antes de subir el código.

-- Alta: aceptación del descargo (las altas anteriores quedan en false)
alter table public.altas add column if not exists consent_descargo boolean not null default false;

-- Torneo: versión del descargo aceptado y aceptación de la grabación
alter table public.inscripciones_torneo add column if not exists descargo_version text;
alter table public.inscripciones_torneo add column if not exists imagen_aceptada boolean not null default false;

-- Función de inscripción con los dos parámetros nuevos (sustituye a la de 10 parámetros)
drop function if exists public.inscribir_torneo(text,text,text,text,text,numeric,text,text,text,text);
create or replace function public.inscribir_torneo(
  p_slug text, p_email text, p_nombre text, p_whatsapp text, p_pais text,
  p_ntrp numeric, p_idioma text, p_compromiso_version text,
  p_privacidad_version text, p_referencia text,
  p_descargo_version text default null, p_imagen boolean default false
) returns table (r_estado text, r_referencia text, r_nuevo boolean, r_hold_hasta timestamptz)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_t public.torneos%rowtype;
  v_cupo integer;
  v_ocupadas integer;
  v_ex public.inscripciones_torneo%rowtype;
  v_estado text;
  v_hold timestamptz;
begin
  select * into v_t from public.torneos where slug = p_slug;
  if not found then raise exception 'torneo_no_existe'; end if;
  if v_t.estado <> 'inscripcion' or now() < v_t.inscripcion_abre or now() > v_t.inscripcion_cierra then
    raise exception 'inscripcion_cerrada';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('torneo:' || v_t.id::text, 0));

  v_cupo := case when v_t.modo = 'MODO_32' then v_t.plazas_max else v_t.plazas_base end;
  select count(*) into v_ocupadas from public.inscripciones_torneo
   where torneo_id = v_t.id
     and (estado = 'pagado' or (estado = 'pendiente_pago' and hold_hasta > now()));

  select * into v_ex from public.inscripciones_torneo where torneo_id = v_t.id and email = p_email;
  if found then
    insert into public.inscripciones_torneo_intentos (torneo_id, email, nombre, whatsapp, pais, ntrp, idioma)
    values (v_t.id, p_email, p_nombre, p_whatsapp, p_pais, p_ntrp, p_idioma);

    -- Pago abandonado: al volver intenta retener plaza de nuevo; si no hay, pasa a reserva.
    if v_ex.estado = 'pendiente_pago' and (v_ex.hold_hasta is null or v_ex.hold_hasta <= now()) then
      if v_ocupadas < v_cupo then
        update public.inscripciones_torneo set hold_hasta = now() + interval '32 minutes'
         where id = v_ex.id returning * into v_ex;
      else
        update public.inscripciones_torneo set estado = 'reserva', hold_hasta = null
         where id = v_ex.id returning * into v_ex;
      end if;
    end if;
    return query select v_ex.estado, v_ex.referencia, false, v_ex.hold_hasta;
    return;
  end if;

  if v_ocupadas < v_cupo then
    v_estado := 'pendiente_pago'; v_hold := now() + interval '32 minutes';
  else
    v_estado := 'reserva'; v_hold := null;
  end if;

  insert into public.inscripciones_torneo
    (torneo_id, email, nombre, whatsapp, pais, ntrp, idioma,
     compromiso_version, privacidad_version, descargo_version, imagen_aceptada,
     estado, referencia, hold_hasta)
  values
    (v_t.id, p_email, btrim(p_nombre), p_whatsapp, p_pais, p_ntrp, p_idioma,
     p_compromiso_version, p_privacidad_version, p_descargo_version, coalesce(p_imagen, false),
     v_estado, p_referencia, v_hold);

  return query select v_estado, p_referencia, true, v_hold;
end $$;

revoke execute on function public.inscribir_torneo(text,text,text,text,text,numeric,text,text,text,text,text,boolean)
  from public, anon, authenticated;
grant execute on function public.inscribir_torneo(text,text,text,text,text,numeric,text,text,text,text,text,boolean) to service_role;
