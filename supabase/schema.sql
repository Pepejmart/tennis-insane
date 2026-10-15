-- Tennis Insane · Alta web · esquema de Supabase (región UE)
-- Pegar entero en SQL Editor > Run. Se puede ejecutar más de una vez.
-- La web nunca habla con estas tablas: solo la función de Netlify, con la clave service_role.

-- 1) Altas: una fila por email. id_cliente NO existe aquí: lo crea el script del Sheet.
create table if not exists public.altas (
  id                 uuid primary key default gen_random_uuid(),
  email              text not null,
  nombre             text not null,
  apellido           text not null,
  whatsapp           text not null check (whatsapp ~ '^\+[1-9][0-9]{6,14}$'),
  pais               char(2) not null check (pais ~ '^[A-Z]{2}$'),
  fecha_nacimiento   date not null check (fecha_nacimiento > date '1900-01-01'),
  genero             text not null check (genero in (
                       'Hombre / Male','Mujer / Female','Otro / Other','Prefiero no decirlo / Prefer not to say')),
  nivel              text not null check (nivel in (
                       'Iniciación / Beginner','Intermedio 2.5-3.0','Intermedio-alto 3.5',
                       'Avanzado 4.0+','No estoy seguro / Not sure')),
  idioma_pref        text not null check (idioma_pref in ('Español','English','Ambos / Both')),
  zona               text,
  intereses          text[] not null default '{}',
  canal              text,
  consent_privacidad boolean not null check (consent_privacidad),
  consent_imagen     boolean not null check (consent_imagen),
  novedades          boolean not null default false,
  consent_version    text not null,                 -- versión del texto aceptado (el texto vive en docs/consentimientos/)
  consent_at         timestamptz not null default now(),
  idioma_form        text not null check (idioma_form in ('es','en')),
  utm_source         text,
  utm_medium         text,
  utm_campaign       text,
  estado             text not null default 'nuevo' check (estado in ('nuevo','contactado','aprobado','descartado')),
  estado_at          timestamptz not null default now(),
  notas              text,
  sincronizado_at    timestamptz,                   -- lo rellena el botón 3 del Apps Script al crear el id_cliente
  creado_at          timestamptz not null default now()
);
create unique index if not exists altas_email_uq on public.altas (email);
create index if not exists altas_estado_idx on public.altas (estado, creado_at);

-- La fecha del estado se actualiza sola al cambiar el estado
create or replace function public.altas_estado_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.estado is distinct from old.estado then new.estado_at := now(); end if;
  return new;
end $$;
drop trigger if exists altas_estado_at on public.altas;
create trigger altas_estado_at before update on public.altas
  for each row execute function public.altas_estado_at();

-- 2) Envíos repetidos: solo se añade. Así nadie puede pisar los datos de otra persona con su email.
create table if not exists public.altas_intentos (
  id         bigint generated always as identity primary key,
  email      text not null,
  payload    jsonb not null,
  creado_at  timestamptz not null default now()
);

-- 3) Eventos anónimos para medir el abandono por paso (sin cookies, sin IP)
create table if not exists public.alta_eventos (
  id          bigint generated always as identity primary key,
  sid         text not null,                        -- id aleatorio por visita
  tipo        text not null check (tipo in ('step_view','step_complete','submit_ok')),
  paso        smallint not null check (paso between 1 and 5),
  idioma      text check (idioma in ('es','en')),
  utm_source  text,
  creado_at   timestamptz not null default now()
);
create index if not exists alta_eventos_idx on public.alta_eventos (creado_at, paso);

-- 4) Seguridad: RLS activado y SIN políticas = ningún acceso desde la web.
--    service_role (solo en la función de Netlify) y el panel de Supabase se saltan RLS.
alter table public.altas           enable row level security;
alter table public.altas_intentos  enable row level security;
alter table public.alta_eventos    enable row level security;
revoke all on table public.altas, public.altas_intentos, public.alta_eventos from anon, authenticated;

-- Abandono por paso (para mirar en el SQL Editor):
-- select paso, count(distinct sid) as visitas from public.alta_eventos where tipo = 'step_view' group by paso order by paso;
