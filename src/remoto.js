// Configuracion remota: el archivo remote/config.json del repositorio de GitHub.
// Al editarlo en GitHub, TODOS los usuarios ven el cambio (anuncios, avisos, precio,
// codigos anulados) sin publicar una version nueva.
const fs = require('fs');
const path = require('path');
const { app, net } = require('electron');
const buildInfo = require('../build-info.json');
const local = require('../remote/config.json');

const cacheFile = () => path.join(app.getPath('userData'), 'remoto-cache.json');

function url() {
  if (!buildInfo.repo) return null;
  return `https://raw.githubusercontent.com/${buildInfo.repo}/${buildInfo.branch || 'main'}/remote/config.json?t=${Date.now()}`;
}

let actual = null;

async function cargar() {
  const u = url();
  if (u) {
    try {
      const res = await net.fetch(u, { cache: 'no-store' });
      if (res.ok) {
        actual = await res.json();
        fs.writeFileSync(cacheFile(), JSON.stringify(actual));
        return actual;
      }
    } catch (_) {}
  }
  try {
    actual = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'));
  } catch (_) {
    actual = local;
  }
  return actual;
}

function get() {
  return actual || local;
}

function linkDescarga() {
  return buildInfo.repo ? `https://github.com/${buildInfo.repo}/releases/latest` : '';
}

module.exports = { cargar, get, linkDescarga };
