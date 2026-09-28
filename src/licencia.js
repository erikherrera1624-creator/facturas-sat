// Licencias sin servidor propio:
//  - Dueño (administrador): tiene la "llave de dueño" (archivo .pem). Uso gratis y total.
//  - Códigos de acceso: los crea el dueño dentro de la app. Van firmados con la llave de dueño,
//    así nadie puede inventarlos. Se pueden anular desde remote/config.json en GitHub.
//  - Suscripción mensual pagada: Lemon Squeezy o Gumroad cobran y dan una clave de licencia;
//    la app pregunta a su API si la suscripción sigue activa.
//  - Prueba gratis: N días (se configura en remote/config.json).
const crypto = require('crypto');
const store = require('./store');
const appConfig = require('../app-config.json');

const DIAS_SIN_INTERNET = 5;

const b64u = {
  enc: (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
};

function publicKeyObj() {
  const raw = (appConfig.llavePublicaDueno || '').trim();
  if (!raw) return null;
  try {
    return crypto.createPublicKey({ key: Buffer.from(raw, 'base64'), format: 'der', type: 'spki' });
  } catch (_) {
    return null;
  }
}

// ---------- Dueño ----------
function crearLlavesDueno() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    privadaPem: privateKey.export({ format: 'pem', type: 'pkcs8' }),
    publicaBase64: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
  };
}

function activarDueno(privadaPem) {
  let priv;
  try {
    priv = crypto.createPrivateKey(privadaPem);
  } catch (_) {
    throw new Error('Ese archivo no es una llave de dueño válida.');
  }
  const pubB64 = crypto.createPublicKey(priv).export({ format: 'der', type: 'spki' }).toString('base64');
  const configurada = (appConfig.llavePublicaDueno || '').trim();
  if (!configurada) {
    return { ok: false, publicaBase64: pubB64, mensaje: 'Aún no pegas tu llave pública en app-config.json. Cópiala, pégala y publica una versión nueva (ver GUIA).' };
  }
  if (configurada !== pubB64) throw new Error('Esta llave no corresponde a esta aplicación.');
  store.update((d) => (d.dueno = { privadaPem }));
  return { ok: true };
}

function esDueno() {
  const d = store.get().dueno;
  if (!d || !d.privadaPem) return false;
  try {
    const pub = crypto.createPublicKey(crypto.createPrivateKey(d.privadaPem)).export({ format: 'der', type: 'spki' }).toString('base64');
    return pub === (appConfig.llavePublicaDueno || '').trim();
  } catch (_) {
    return false;
  }
}

// ---------- Códigos de acceso ----------
// Formato: FSAT-<datos>.<firma>   datos = {i:id, n:nombre, v:vence(YYYY-MM-DD), p:plan}
function generarCodigo({ nombre, vence, plan }) {
  if (!esDueno()) throw new Error('Solo el dueño puede crear códigos.');
  const priv = crypto.createPrivateKey(store.get().dueno.privadaPem);
  const payload = { i: crypto.randomBytes(4).toString('hex'), n: String(nombre || '').slice(0, 40), v: vence || '', p: plan === 'basico' ? 'b' : 'p' };
  const data = Buffer.from(JSON.stringify(payload), 'utf8');
  const sig = crypto.sign(null, data, priv);
  const codigo = `FSAT-${b64u.enc(data)}.${b64u.enc(sig)}`;
  store.update((d) => d.codigosGenerados.unshift({ ...payload, codigo, creado: new Date().toISOString() }));
  return codigo;
}

function leerCodigo(codigo) {
  const pub = publicKeyObj();
  if (!pub) throw new Error('La aplicación aún no tiene configurada la llave del dueño.');
  const m = /^FSAT-([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(codigo).trim());
  if (!m) throw new Error('El código no tiene el formato correcto.');
  const data = b64u.dec(m[1]);
  if (!crypto.verify(null, data, pub, b64u.dec(m[2]))) throw new Error('El código no es válido.');
  return JSON.parse(data.toString('utf8'));
}

function codigoVigente(payload, remote) {
  if ((remote.codigosRevocados || []).includes(payload.i)) return 'Este código fue anulado.';
  if (payload.v && new Date(payload.v + 'T23:59:59') < new Date()) return `Este código venció el ${payload.v}.`;
  return null;
}

// ---------- Suscripción pagada ----------
async function validarClavePagada(clave) {
  const prov = (appConfig.pagos && appConfig.pagos.proveedor) || 'lemonsqueezy';
  const { net } = require('electron');
  if (prov === 'gumroad') {
    const body = new URLSearchParams({ product_id: appConfig.pagos.gumroadProductId, license_key: clave, increment_uses_count: 'false' });
    const res = await net.fetch('https://api.gumroad.com/v2/licenses/verify', { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const j = await res.json().catch(() => ({}));
    if (!j.success) return { valida: false, motivo: j.message || 'Clave no encontrada.' };
    const p = j.purchase || {};
    if (p.refunded || p.chargebacked) return { valida: false, motivo: 'La compra fue reembolsada.' };
    if (p.subscription_ended_at || p.subscription_cancelled_at || p.subscription_failed_at) {
      return { valida: false, motivo: 'La suscripción no está activa. Renueva tu pago.' };
    }
    return { valida: true, correo: p.email || '' };
  }
  const body = new URLSearchParams({ license_key: clave });
  const res = await net.fetch('https://api.lemonsqueezy.com/v1/licenses/validate', { method: 'POST', body, headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' } });
  const j = await res.json().catch(() => ({}));
  const storeId = String(appConfig.pagos.lemonsqueezyStoreId || '');
  if (!j.valid) return { valida: false, motivo: j.error || 'Clave no válida.' };
  if (storeId && String(j.meta && j.meta.store_id) !== storeId) return { valida: false, motivo: 'Esta clave es de otra tienda.' };
  const st = j.license_key && j.license_key.status;
  if (st !== 'active' && st !== 'inactive') return { valida: false, motivo: 'La suscripción no está activa. Renueva tu pago.' };
  return { valida: true, correo: (j.meta && j.meta.customer_email) || '' };
}

// ---------- Estado general ----------
// Devuelve { acceso: bool, rol: 'dueno'|'pago'|'codigo'|'prueba'|null, plan: 'pro'|'basico', mensaje, diasPrueba }
async function estado(remote) {
  if (esDueno()) return { acceso: true, rol: 'dueno', plan: 'pro', mensaje: 'Modo dueño' };
  const d = store.get();
  const lic = d.licencia;

  if (lic && lic.tipo === 'codigo') {
    try {
      const p = leerCodigo(lic.clave);
      const err = codigoVigente(p, remote);
      if (!err) return { acceso: true, rol: 'codigo', plan: p.p === 'b' ? 'basico' : 'pro', mensaje: `Código de acceso${p.v ? ' · vence ' + p.v : ''}`, nombre: p.n };
      return { acceso: false, rol: null, mensaje: err };
    } catch (e) {
      return { acceso: false, rol: null, mensaje: e.message };
    }
  }

  if (lic && lic.tipo === 'pago') {
    try {
      const r = await validarClavePagada(lic.clave);
      if (r.valida) {
        store.update((x) => (x.licencia.ultimaValidacion = Date.now()));
        return { acceso: true, rol: 'pago', plan: 'pro', mensaje: 'Suscripción activa' };
      }
      return { acceso: false, rol: null, mensaje: r.motivo };
    } catch (_) {
      // Sin internet: se permite unos días con la última validación buena.
      if (lic.ultimaValidacion && Date.now() - lic.ultimaValidacion < DIAS_SIN_INTERNET * 86400_000) {
        return { acceso: true, rol: 'pago', plan: 'pro', mensaje: 'Suscripción activa (sin conexión)' };
      }
      return { acceso: false, rol: null, mensaje: 'No se pudo comprobar tu suscripción. Revisa tu internet.' };
    }
  }

  const dias = Number(remote.diasDePrueba || 0);
  if (dias > 0) {
    if (!d.pruebaInicio) store.update((x) => (x.pruebaInicio = Date.now()));
    const restantes = Math.ceil(dias - (Date.now() - store.get().pruebaInicio) / 86400_000);
    if (restantes > 0) return { acceso: true, rol: 'prueba', plan: 'basico', mensaje: `Prueba gratis · quedan ${restantes} día(s)`, diasPrueba: restantes };
    return { acceso: false, rol: null, mensaje: 'Tu prueba gratis terminó.' };
  }
  return { acceso: false, rol: null, mensaje: 'Necesitas una suscripción o un código de acceso.' };
}

async function activar(clave, remote) {
  clave = String(clave || '').trim();
  if (!clave) throw new Error('Escribe tu código o clave.');
  if (clave.startsWith('FSAT-')) {
    const p = leerCodigo(clave);
    const err = codigoVigente(p, remote);
    if (err) throw new Error(err);
    store.update((d) => (d.licencia = { tipo: 'codigo', clave }));
  } else {
    const r = await validarClavePagada(clave);
    if (!r.valida) throw new Error(r.motivo);
    store.update((d) => (d.licencia = { tipo: 'pago', clave, ultimaValidacion: Date.now() }));
  }
  return estado(remote);
}

function salirLicencia() {
  store.update((d) => {
    d.licencia = null;
    d.dueno = null;
  });
}

module.exports = { estado, activar, salirLicencia, crearLlavesDueno, activarDueno, esDueno, generarCodigo };
