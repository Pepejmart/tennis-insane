-- supabase/torneos.sql · Torneo de Invierno (TO2)
-- Aditivo y repetible: no toca altas, altas_intentos ni alta_eventos.
-- Patrón del alta: RLS activado SIN políticas; solo las funciones de Netlify
-- (clave secreta, solo en variables de entorno) leen y escriben.

-- ───────────────────────── torneos ─────────────────────────
create table if not exists public.torneos (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  nombre              text not null,
  inscripcion_abre    timestamptz not null,
  inscripcion_cierra  timestamptz not null,
  sorteo_fecha        date,
  juego_inicio        date not null,
  juego_fin           date not null,
  precio_centimos     integer not null check (precio_centimos >= 0),
  plazas_base         integer not null check (plazas_base > 0),
  plazas_max          integer not null,
  modo                text not null default 'MODO_24' check (modo in ('MODO_24','MODO_32')),
  estado              text not null default 'borrador'
                      check (estado in ('borrador','inscripcion','en_juego','finalizado')),
  created_at          timestamptz not null default now(),
  check (plazas_max >= plazas_base),
  check (inscripcion_cierra > inscripcion_abre),
  check (juego_fin >= juego_inicio)
);

-- ───────────────────── inscripciones_torneo ─────────────────────
create table if not exists public.inscripciones_torneo (
  id                  uuid primary key default gen_random_uuid(),
  torneo_id           uuid not null references public.torneos(id) on delete restrict,
  orden               bigint generated always as identity,          -- orden de llegada (lista de reserva)
  email               text not null
                      check (email = lower(btrim(email)) and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$'),
  nombre              text not null check (char_length(btrim(nombre)) between 3 and 80),
  whatsapp            text not null check (whatsapp ~ '^\+[1-9][0-9]{6,14}$'),
  pais                text not null check (pais ~ '^[A-Z]{2}$'),     -- ISO 3166-1 alfa-2
  ntrp                numeric(2,1) check (ntrp is null or ntrp in (2.0,2.5,3.0,3.5,4.0,4.5,5.0)), -- null = «no lo sé»; 5.0 = 5.0+
  idioma              text not null default 'es' check (idioma in ('es','en')),
  compromiso_version  text not null,
  compromiso_at       timestamptz not null default now(),
  privacidad_version  text not null,
  privacidad_at       timestamptz not null default now(),
  estado              text not null default 'pendiente_pago'
                      check (estado in ('pendiente_pago','pagado','reserva','cancelado')),
  estado_at           timestamptz not null default now(),
  referencia          text not null unique check (referencia ~ '^TI-[A-Z0-9]{2,6}-[A-Z0-9]{4,8}$'),
  metodo_pago         text check (metodo_pago in ('stripe','manual')),
  importe_centimos    integer check (importe_centimos is null or importe_centimos >= 0),
  stripe_session_id   text unique,
  stripe_payment_intent text,
  pagado_at           timestamptz,
  notas               text,
  created_at          timestamptz not null default now(),
  unique (torneo_id, email)
);
create index if not exists inscripciones_torneo_estado_idx
  on public.inscripciones_torneo (torneo_id, estado, orden);

-- estado_at se actualiza solo cuando cambia el estado
create or replace function public.torneos_set_estado_at() returns trigger
language plpgsql as $$
begin
  if new.estado is distinct from old.estado then new.estado_at := now(); end if;
  return new;
end $$;
drop trigger if exists inscripciones_torneo_estado_at on public.inscripciones_torneo;
create trigger inscripciones_torneo_estado_at
  before update on public.inscripciones_torneo
  for each row execute function public.torneos_set_estado_at();

-- ───────────── intentos repetidos (solo se añade) ─────────────
create table if not exists public.inscripciones_torneo_intentos (
  id          bigint generated always as identity primary key,
  torneo_id   uuid not null references public.torneos(id) on delete restrict,
  email       text not null,
  nombre      text,
  whatsapp    text,
  pais        text,
  ntrp        numeric(2,1),
  idioma      text,
  created_at  timestamptz not null default now()
);

-- ───────────── abandono anónimo (sin cookies ni IP) ─────────────
create table if not exists public.eventos_torneo (
  id          bigint generated always as identity primary key,
  torneo_id   uuid not null references public.torneos(id) on delete restrict,
  tipo        text not null check (tipo in ('paso_visto','enviado','error')),
  paso        smallint check (paso between 1 and 2),
  created_at  timestamptz not null default now()
);

-- ───────────── inscripción atómica ─────────────
-- La plaza solo la ocupa quien ha pagado, o quien tiene un pago en curso
-- (hold_hasta: retención de 32 min, alineada con la caducidad de la sesión de
-- Stripe Checkout, que admite entre 30 min y 24 h). Pago abandonado = plaza libre.
alter table public.inscripciones_torneo add column if not exists hold_hasta timestamptz;

-- La llama solo la función de Netlify con la clave secreta. La referencia se
-- calcula fuera (HMAC de torneo+email), así una repetición devuelve la misma.
drop function if exists public.inscribir_torneo(text,text,text,text,text,numeric,text,text,text,text);
create or replace function public.inscribir_torneo(
  p_slug text, p_email text, p_nombre text, p_whatsapp text, p_pais text,
  p_ntrp numeric, p_idioma text, p_compromiso_version text,
  p_privacidad_version text, p_referencia text
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
     compromiso_version, privacidad_version, estado, referencia, hold_hasta)
  values
    (v_t.id, p_email, btrim(p_nombre), p_whatsapp, p_pais, p_ntrp, p_idioma,
     p_compromiso_version, p_privacidad_version, v_estado, p_referencia, v_hold);

  return query select v_estado, p_referencia, true, v_hold;
end $$;

-- Alta manual por el equipo (desde el editor SQL de Supabase): cuenta como pagada
-- (metodo 'manual') y ocupa plaza; no se bloquea por cupo. Si el email ya existe
-- (p. ej. en reserva), lo pasa a pagado. Uso:
--   select * from public.agregar_manual_torneo('to2','nombre@example.test','Nombre Apellido','+34600000000','ES',3.5,'nota');
create or replace function public.agregar_manual_torneo(
  p_slug text, p_email text, p_nombre text, p_whatsapp text, p_pais text,
  p_ntrp numeric default null, p_notas text default null
) returns table (r_estado text, r_referencia text, r_pagadas integer, r_cupo integer)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_t public.torneos%rowtype;
  v_email text := lower(btrim(p_email));
  v_ref text;
  v_ex public.inscripciones_torneo%rowtype;
begin
  select * into v_t from public.torneos where slug = p_slug;
  if not found then raise exception 'torneo_no_existe'; end if;
  perform pg_advisory_xact_lock(hashtextextended('torneo:' || v_t.id::text, 0));

  select * into v_ex from public.inscripciones_torneo where torneo_id = v_t.id and email = v_email;
  if found then
    update public.inscripciones_torneo
       set estado = 'pagado', metodo_pago = 'manual', pagado_at = now(), hold_hasta = null,
           notas = coalesce(p_notas, notas)
     where id = v_ex.id returning referencia into v_ref;
  else
    v_ref := 'TI-' || left(upper(regexp_replace(v_t.slug, '[^a-z0-9]', '', 'g')), 6) || '-' ||
             upper(substr(md5(random()::text || clock_timestamp()::text), 1, 5));
    insert into public.inscripciones_torneo
      (torneo_id, email, nombre, whatsapp, pais, ntrp, idioma,
       compromiso_version, privacidad_version, estado, referencia, metodo_pago, pagado_at, notas)
    values
      (v_t.id, v_email, btrim(p_nombre), p_whatsapp, upper(p_pais), p_ntrp, 'es',
       'manual-equipo', 'manual-equipo', 'pagado', v_ref, 'manual', now(), p_notas);
  end if;

  return query select 'pagado'::text, v_ref,
    (select count(*)::integer from public.inscripciones_torneo where torneo_id = v_t.id and estado = 'pagado'),
    case when v_t.modo = 'MODO_32' then v_t.plazas_max else v_t.plazas_base end;
end $$;

-- ───────────── seguridad: RLS sin políticas y permisos cerrados ─────────────
alter table public.torneos                      enable row level security;
alter table public.inscripciones_torneo         enable row level security;
alter table public.inscripciones_torneo_intentos enable row level security;
alter table public.eventos_torneo               enable row level security;

revoke all on public.torneos                       from anon, authenticated;
revoke all on public.inscripciones_torneo          from anon, authenticated;
revoke all on public.inscripciones_torneo_intentos from anon, authenticated;
revoke all on public.eventos_torneo                from anon, authenticated;

revoke execute on function public.inscribir_torneo(text,text,text,text,text,numeric,text,text,text,text)
  from public, anon, authenticated;
revoke execute on function public.agregar_manual_torneo(text,text,text,text,text,numeric,text)
  from public, anon, authenticated;
revoke execute on function public.torneos_set_estado_at() from public, anon, authenticated;

alter function public.torneos_set_estado_at() set search_path = public, pg_temp;

grant all on public.torneos, public.inscripciones_torneo,
             public.inscripciones_torneo_intentos, public.eventos_torneo to service_role;
grant execute on function public.inscribir_torneo(text,text,text,text,text,numeric,text,text,text,text) to service_role;
grant execute on function public.agregar_manual_torneo(text,text,text,text,text,numeric,text) to service_role;

-- ───────────── torneo de invierno (TO2) ─────────────
insert into public.torneos
  (slug, nombre, inscripcion_abre, inscripcion_cierra, sorteo_fecha,
   juego_inicio, juego_fin, precio_centimos, plazas_base, plazas_max, modo, estado)
values
  ('to2', 'Torneo de Invierno',
   timestamp '2026-10-26 00:00' at time zone 'Europe/Madrid',
   timestamp '2026-11-11 23:59' at time zone 'Europe/Madrid',
   date '2026-11-13', date '2026-11-15', date '2027-01-17',
   2200, 24, 32, 'MODO_24', 'inscripcion')
on conflict (slug) do nothing;

-- ───────────── aviso del analizador de seguridad (aplicado una vez) ─────────────
do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'rls_auto_enable') then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;
