// Base de datos local. Las contraseñas, la CIEC y la e.firma se guardan cifradas
// con el cifrado de Windows (solo se pueden leer en esta computadora y con este usuario).
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const dir = () => app.getPath('userData');
const secretFile = () => path.join(dir(), 'datos.bin');

const DEFAULTS = {
  contribuyentes: [],
  ajustes: {
    carpetaDescargas: '',
    columnas: null,
    hojaConceptos: false,
    hojaPagos: true,
    generarPdf: true,
  },
  licencia: null,
  dueno: null,
  codigosGenerados: [],
  pruebaInicio: null,
};

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(secretFile());
    const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8');
    cache = { ...structuredClone(DEFAULTS), ...JSON.parse(json) };
    cache.ajustes = { ...DEFAULTS.ajustes, ...cache.ajustes };
  } catch (_) {
    cache = structuredClone(DEFAULTS);
  }
  if (!cache.ajustes.carpetaDescargas) {
    cache.ajustes.carpetaDescargas = path.join(app.getPath('documents'), 'Facturas SAT');
  }
  return cache;
}

function save() {
  const json = JSON.stringify(cache);
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json, 'utf8');
  fs.mkdirSync(dir(), { recursive: true });
  const tmp = secretFile() + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, secretFile());
}

function get() {
  return load();
}

function update(fn) {
  load();
  fn(cache);
  save();
  return cache;
}

// ---------- Indice de facturas por RFC ----------
function indexFile(rfc) {
  return path.join(dir(), `indice-${rfc}.json`);
}

function readIndex(rfc) {
  try {
    return JSON.parse(fs.readFileSync(indexFile(rfc), 'utf8'));
  } catch (_) {
    return {};
  }
}

function writeIndex(rfc, index) {
  const tmp = indexFile(rfc) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(index));
  fs.renameSync(tmp, indexFile(rfc));
}

// ---------- Solicitudes al SAT pendientes (para reanudar) ----------
function solicitudesFile(rfc) {
  return path.join(dir(), `solicitudes-${rfc}.json`);
}

function readSolicitudes(rfc) {
  try {
    return JSON.parse(fs.readFileSync(solicitudesFile(rfc), 'utf8'));
  } catch (_) {
    return {};
  }
}

function writeSolicitudes(rfc, data) {
  fs.writeFileSync(solicitudesFile(rfc), JSON.stringify(data, null, 1));
}

module.exports = { get, update, readIndex, writeIndex, readSolicitudes, writeSolicitudes };
