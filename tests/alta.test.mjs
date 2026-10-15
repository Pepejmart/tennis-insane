// Ejecutar con: node --test tests/*.test.mjs   (solo datos ficticios)
import test from 'node:test';
import assert from 'node:assert/strict';
import { clean } from '../netlify/functions/alta.mjs';

const base = () => ({
  email: ' Prueba@Example.test ', nombre: 'Test', apellido: 'Persona', whatsapp: '+34600000000', pais: 'mx',
  fecha_nacimiento: '1990-05-10', genero: 'Mujer / Female', nivel: 'Intermedio 2.5-3.0', idioma_pref: 'Ambos / Both',
  zona: "No sé / I don't know", intereses: ['clases', 'comunidad', 'clases', 'otra_cosa'], canal: 'Instagram',
  consent_privacidad: true, consent_imagen: true, novedades: false, consent_version: 'x', idioma_form: 'es'
});
const now = new Date('2026-10-15T12:00:00Z');

test('alta válida: normaliza email y país, quita intereses repetidos o desconocidos', () => {
  const r = clean(base(), now);
  assert.equal(r.email, 'prueba@example.test');
  assert.equal(r.pais, 'MX');
  assert.deepEqual(r.intereses, ['clases', 'comunidad']);
  assert.equal(r.zona, "No sé / I don't know");
});
test('menor de 18: rechazada', () => assert.equal(clean({ ...base(), fecha_nacimiento: '2010-01-01' }, now), null));
test('cumple 18 mañana: rechazada; hoy: aceptada', () => {
  assert.equal(clean({ ...base(), fecha_nacimiento: '2008-10-16' }, now), null);
  assert.ok(clean({ ...base(), fecha_nacimiento: '2008-10-15' }, now));
});
test('WhatsApp sin formato internacional: rechazado', () => assert.equal(clean({ ...base(), whatsapp: '600000000' }, now), null));
test('sin consentimiento de imagen: rechazada', () => assert.equal(clean({ ...base(), consent_imagen: false }, now), null));
test('género vacío: rechazada (es obligatorio)', () => assert.equal(clean({ ...base(), genero: '' }, now), null));
test('zona o canal fuera de lista: rechazada', () => {
  assert.equal(clean({ ...base(), zona: 'Narnia' }, now), null);
  assert.equal(clean({ ...base(), canal: 'Radio' }, now), null);
});
test('zona y canal vacíos: aceptada (son opcionales)', () => assert.ok(clean({ ...base(), zona: '', canal: '' }, now)));
