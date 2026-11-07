// challenge_photos_v1: validación pura del lado cliente y garantía de que las fotos no se guardan.
const assert = require('node:assert/strict');
const fs = require('node:fs');
function element(type = 'div') { return { type, textContent: '', value: '', disabled: false, children: [], append(...i) { this.children.push(...i); }, appendChild(i) { this.children.push(i); return i; }, replaceChildren(...i) { this.children = i; }, addEventListener() {}, setAttribute() {}, classList: { add() {}, remove() {} } }; }
global.document = { getElementById: () => element(), createElement: t => element(t) };
global.localStorage = { getItem: () => null, setItem: () => {} };
global.confirm = () => true;
const p = require('../app.js');
const ph = (n = 100, mime = 'image/jpeg') => ({ mime, data: 'A'.repeat(n) });

assert.deepEqual(p.validatePhotoPayload([]), []);
assert.deepEqual(p.validatePhotoPayload(null), []);
assert.equal(p.validatePhotoPayload([ph()]).length, 1);
assert.equal(p.validatePhotoPayload([ph(), ph(200, 'image/png')]).length, 2);
assert.throws(() => p.validatePhotoPayload([ph(), ph(), ph()]), /hasta 2/);
assert.throws(() => p.validatePhotoPayload([ph(100, 'image/gif')]), /no es válida/);
assert.throws(() => p.validatePhotoPayload([ph(1_500_000)]), /pesa demasiado/);
assert.throws(() => p.validatePhotoPayload([{ mime: 'image/jpeg' }]), /no es válida/);
assert.throws(() => p.validatePhotoPayload('x'), /hasta 2/);
assert.equal(p.validatePhotoPayload([ph(1_333_333)]).length, 1, 'justo bajo 1 MB decodificado');

const src = fs.readFileSync(require.resolve('../app.js'), 'utf8');
assert.equal(p.PHOTO_NOTICE, 'Las fotos se envían a Gemini (Google) solo para valorar este informe y no se guardan. No incluyas personas ni datos personales.');
assert.ok(src.includes(p.PHOTO_NOTICE), 'el aviso se muestra');
assert.ok(!/goal\.challenge\.photos|c\.photos|goal\.photos/.test(src), 'las fotos no entran en el estado de la meta');
assert.ok(!/localStorage[^;]{0,80}photos|photos[^;]{0,80}localStorage/.test(src), 'las fotos no van a localStorage');
console.log('challenge_photos: OK');
