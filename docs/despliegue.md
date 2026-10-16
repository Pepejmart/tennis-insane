# Despliegue del alta (fase C)

Estructura del repositorio: `web/join/` (la página; cada sección futura tendrá su carpeta: `web/tournaments/`, `web/lessons/`), `netlify/functions/` (alta y evento), `supabase/schema.sql`, `netlify.toml`.
Nada de claves en el repositorio ni en el HTML.

## 1. Supabase (5 min)
1. Crear proyecto en región **UE** (Frankfurt).
2. SQL Editor → pegar `supabase/schema.sql` → Run. Debe terminar sin errores.
3. Project Settings → API: copiar el **Project URL** (solo `https://<proyecto>.supabase.co`, sin `/rest/v1/`) y la clave **secreta** (`sb_secret_…`, o `service_role` en las claves antiguas). La clave pública (`publishable`/`anon`) no se usa. Las variables van en Netlify, nunca en un `.env` dentro del repositorio.

## 2. Cloudflare Turnstile (5 min)
1. Crear un widget (modo «managed») con el hostname exacto de tu sitio (`tu-sitio.netlify.app`) y, más adelante, añadir el subdominio de tennisinsane.com.
2. Copiar la **site key** (pública) y la **secret key**.

## 3. Netlify (10 min)
1. Subir esta carpeta a un repositorio de GitHub (privado).
2. Netlify → Add new site → Import from Git. Publish directory `web` (ya está en `netlify.toml`).
3. Site configuration → Environment variables (marcar como secretas):
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `TURNSTILE_SECRET`
   - `WHATSAPP_COMMUNITY_URL` (el enlace de la comunidad)
4. En `web/index.html`, poner la site key en `TURNSTILE_SITEKEY` (es pública) y hacer commit.
5. Esperar al despliegue y abrir la URL de previsualización.

## 4. Comprobaciones antes de abrir al público
- Alta de prueba con datos ficticios (`@example.test`): aparece 1 fila en `altas` con estado `nuevo`.
- Repetir el mismo email: misma pantalla final, sigue 1 fila en `altas` y 1 nueva en `altas_intentos`.
- Ver código fuente de la página: no debe aparecer ningún `chat.whatsapp.com`.
- Probar con `?demo=1`: no envía nada.
- Una fecha de menor de 18 no avanza.
- RLS: desde fuera, `curl "$SUPABASE_URL/rest/v1/altas?select=*" -H "apikey: <clave anon>"` debe dar permiso denegado o lista vacía, nunca datos.
- Cambiar un `estado` en el Table Editor: `estado_at` se actualiza sola.
- Borrar las altas de prueba antes del lanzamiento.

## 5. Para confirmar
- **Límite por IP:** `rateLimit` en las funciones es la opción de Netlify. Confirmar en su documentación que tu plan lo admite; si no, la protección queda en Turnstile y en la restricción de email único.
- **CSP:** `netlify.toml` limita de dónde carga la página. Si algo no carga (fuentes, Turnstile), mirar la consola del navegador.
- **Textos legales:** el aviso de privacidad y el texto de imagen son un borrador. Guardar cada versión en `docs/consentimientos/` con el valor de `consent_version`.
- **Estado de las altas:** de momento se cambia en el Table Editor de Supabase.
- **Tests:** `node --test tests/*.test.mjs` valida las reglas de `alta.mjs` con datos ficticios.

## 6. Si sale «No hemos podido enviar tu alta»
1. Añade `?debug=1` a la URL y repite el envío: el aviso muestra un código entre corchetes.
2. Abre `https://TU-SITIO/api/alta` en el navegador. Si la función está viva, responde `{"ok":false}` (es un 405 normal, solo acepta envíos). Si da **404**, las funciones no están desplegadas: pasa si subiste solo la carpeta `web` arrastrándola, o si el build rechazó `rateLimit` (Deploys → Functions; en ese caso borra el bloque `rateLimit` de `alta.mjs` y `evento.mjs`).
3. **[500]**: faltan variables de entorno o Supabase rechaza el alta. Mira Netlify → Logs → Functions → `alta`. Comprueba que `schema.sql` se ejecutó y que la clave es la secreta (`service_role`), no la `anon`.
4. **[400 captcha]**: está `TURNSTILE_SECRET` en Netlify pero la site key no está puesta en `TURNSTILE_SITEKEY` de `web/index.html`, o el dominio no está en el widget. Para probar sin captcha, borra la variable `TURNSTILE_SECRET`.
5. **[400 invalid]**: algún campo no pasa la validación del servidor (formato del WhatsApp, fecha, valores de las listas).
6. **[sin respuesta]**: no hay red o la página se abrió como archivo local.

Para ver la pantalla final sin servidor: `?demo=1`.

## 7. Antes de abrir al público: lo legal y la limpieza
**Marcadores a sustituir en `web/index.html`** (aviso de privacidad, en ES y en EN): `[NIF]`, `[EMAIL DE CONTACTO]`, `[PLAZO]` y `[LISTA DE ENCARGADOS]`. Al aprobarlo el gestor, quitar la línea de la etiqueta «Borrador / Draft» y cambiar `TERMS_VERSION` (por ejemplo `2026-11-v1`). Guardar el texto aprobado en `docs/consentimientos/<versión>.md`.

**Preguntas para el gestor**
1. Responsable (Jaime como autónomo): NIF y email de contacto.
2. Base legal de cada finalidad (alta y comunidad, organización de eventos, estadística de edad, felicitación de cumpleaños, imagen, novedades).
3. Plazo de conservación tras la baja.
4. Encargados y transferencias: Supabase (UE), Netlify, Cloudflare (Turnstile), Google (Sheets, Apps Script, Gmail) y WhatsApp.
5. Si se puede exigir la casilla de imagen para entrar o debe ser opcional.
6. Si pedir la fecha de nacimiento completa se ajusta a los dos fines declarados.
7. Si hace falta registro de actividades de tratamiento.

**Limpieza de pruebas** (SQL Editor de Supabase, solo antes del lanzamiento y solo con datos ficticios):
```sql
delete from public.altas           where email like '%@example.test';
delete from public.altas_intentos  where email like '%@example.test';
delete from public.alta_eventos;   -- solo si todo el tráfico hasta ahora ha sido de prueba
select count(*) from public.altas; -- debe dar 0 si nadie real se ha dado de alta
```

## 8. Dominio: app.tennisinsane.com y tennisinsane.com/join
- La app vive en el subdominio `app.tennisinsane.com` (Netlify). La web de Jaime (WordPress) no cambia de contenido ni de direcciones.
- `tennisinsane.com/join` es solo una redirección (302, pasando los parámetros UTM) hacia `https://app.tennisinsane.com/join`.
- DNS: se **añade** un único registro CNAME `app` → `<tu-sitio>.netlify.app`. No se tocan los registros existentes.
- Turnstile: añadir `app.tennisinsane.com` a los hostnames del widget.
- Cada sección nueva (`/tournaments`, `/lessons`) = carpeta nueva en `web/` + su redirección en WordPress. Antes de crear una, comprobar que ese slug no existe ya en WordPress.
- En el rediseño de la web, se mueve todo bajo tennisinsane.com y se quitan las redirecciones: las URLs públicas no cambian.
