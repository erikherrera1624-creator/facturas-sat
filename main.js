const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');

const store = require('./src/store');
const remoto = require('./src/remoto');
const licencia = require('./src/licencia');
const { Fiel } = require('./src/sat/fiel');
const { Descarga, filtrar, exportarExcel, importarCarpeta, carpetaRfc } = require('./src/descargas');
const { COLUMNAS, PRESETS } = require('./src/cfdi/columnas');

let win;
let descargaActual = null;
let licenciaActual = { acceso: false };

function crearVentana() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#ffffff',
    title: 'Facturas SAT',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    abrirExterno(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function abrirExterno(url) {
  if (/^https?:\/\//i.test(String(url))) shell.openExternal(url);
}

function send(canal, data) {
  if (win && !win.isDestroyed()) win.webContents.send(canal, data);
}

// ---------- Actualizaciones automaticas (GitHub Releases) ----------
function iniciarActualizaciones() {
  if (!app.isPackaged) return;
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (_) {
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', (i) => send('update', { estado: 'descargando', version: i.version }));
  autoUpdater.on('update-downloaded', (i) => send('update', { estado: 'lista', version: i.version }));
  autoUpdater.on('error', () => {});
  ipcMain.handle('update:instalar', () => autoUpdater.quitAndInstall());
  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 3600_000);
}

// ---------- Utilidades ----------
function contribuyentesPublicos() {
  return store.get().contribuyentes.map((c) => ({
    id: c.id,
    rfc: c.rfc,
    nombre: c.nombre,
    tieneCiec: !!c.ciec,
    tieneFiel: !!(c.cer && c.key && c.fielPassword),
    fiel: c.fielInfo || null,
  }));
}

function requiereAcceso() {
  if (!licenciaActual.acceso) throw new Error('Necesitas activar tu licencia para usar esta función.');
}

function handle(canal, fn) {
  ipcMain.handle(canal, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });
}

// ---------- IPC ----------
handle('app:init', async () => {
  const remote = await remoto.cargar();
  licenciaActual = await licencia.estado(remote);
  const d = store.get();
  return {
    version: app.getVersion(),
    licencia: licenciaActual,
    remote,
    contribuyentes: contribuyentesPublicos(),
    ajustes: d.ajustes,
    columnas: COLUMNAS,
    presets: PRESETS,
    linkDescarga: remoto.linkDescarga(),
    contactoSoporte: require('./app-config.json').contactoSoporte || '',
  };
});

handle('licencia:activar', async (clave) => {
  licenciaActual = await licencia.activar(clave, remoto.get());
  return licenciaActual;
});

handle('licencia:salir', async () => {
  licencia.salirLicencia();
  licenciaActual = await licencia.estado(remoto.get());
  return licenciaActual;
});

// Dueño
handle('dueno:crearLlaves', async () => {
  const { privadaPem, publicaBase64 } = licencia.crearLlavesDueno();
  const r = await dialog.showSaveDialog(win, {
    title: 'Guarda tu LLAVE DE DUEÑO (no la compartas)',
    defaultPath: path.join(app.getPath('documents'), 'llave-dueno-facturas-sat.pem'),
    filters: [{ name: 'Llave', extensions: ['pem'] }],
  });
  if (r.canceled || !r.filePath) throw new Error('Cancelado.');
  fs.writeFileSync(r.filePath, privadaPem);
  return { publicaBase64, archivo: r.filePath };
});

handle('dueno:activar', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Selecciona tu llave de dueño', filters: [{ name: 'Llave', extensions: ['pem'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) throw new Error('Cancelado.');
  const res = licencia.activarDueno(fs.readFileSync(r.filePaths[0], 'utf8'));
  licenciaActual = await licencia.estado(remoto.get());
  return { ...res, licencia: licenciaActual };
});

handle('dueno:generarCodigo', async (datos) => licencia.generarCodigo(datos));
handle('dueno:codigos', async () => (licencia.esDueno() ? store.get().codigosGenerados : []));

// Contribuyentes
handle('contrib:guardar', async (c) => {
  const d = store.get();
  const existente = c.id ? d.contribuyentes.find((x) => x.id === c.id) : null;
  const nuevo = existente ? { ...existente } : { id: crypto.randomUUID() };
  nuevo.rfc = String(c.rfc || '').trim().toUpperCase();
  nuevo.nombre = String(c.nombre || '').trim();
  if (!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(nuevo.rfc)) throw new Error('El RFC no parece válido.');
  if (c.ciec) nuevo.ciec = c.ciec;
  if (c.cerPath) nuevo.cer = fs.readFileSync(c.cerPath).toString('base64');
  if (c.keyPath) nuevo.key = fs.readFileSync(c.keyPath).toString('base64');
  if (c.fielPassword) nuevo.fielPassword = c.fielPassword;

  if (nuevo.cer && nuevo.key && nuevo.fielPassword) {
    const f = new Fiel(Buffer.from(nuevo.cer, 'base64'), Buffer.from(nuevo.key, 'base64'), nuevo.fielPassword);
    if (f.esCSD) throw new Error('Ese certificado es un Sello Digital (CSD). Se necesita la e.firma (FIEL).');
    if (f.rfc && f.rfc !== nuevo.rfc) throw new Error(`La e.firma pertenece al RFC ${f.rfc}.`);
    nuevo.fielInfo = f.info();
    if (!nuevo.nombre) nuevo.nombre = f.nombre;
  }
  store.update((x) => {
    const i = x.contribuyentes.findIndex((y) => y.id === nuevo.id);
    if (i >= 0) x.contribuyentes[i] = nuevo;
    else x.contribuyentes.push(nuevo);
  });
  return contribuyentesPublicos();
});

handle('contrib:eliminar', async (id) => {
  store.update((x) => (x.contribuyentes = x.contribuyentes.filter((c) => c.id !== id)));
  return contribuyentesPublicos();
});

handle('contrib:copiarCiec', async (id) => {
  const c = store.get().contribuyentes.find((x) => x.id === id);
  if (!c || !c.ciec) throw new Error('Este RFC no tiene CIEC guardada.');
  clipboard.writeText(c.ciec);
  setTimeout(() => {
    if (clipboard.readText() === c.ciec) clipboard.clear();
  }, 60_000);
  return true;
});

handle('dialog:archivo', async (tipo) => {
  const filtros = {
    cer: [{ name: 'Certificado (.cer)', extensions: ['cer'] }],
    key: [{ name: 'Llave privada (.key)', extensions: ['key'] }],
  };
  const r = await dialog.showOpenDialog(win, { filters: filtros[tipo], properties: ['openFile'] });
  return r.canceled ? null : r.filePaths[0];
});

handle('dialog:carpeta', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

// Ajustes
handle('ajustes:guardar', async (a) => {
  store.update((x) => (x.ajustes = { ...x.ajustes, ...a }));
  return store.get().ajustes;
});

// Descarga masiva
handle('descarga:iniciar', async (opciones) => {
  requiereAcceso();
  if (descargaActual) throw new Error('Ya hay una descarga en curso.');
  descargaActual = new Descarga(opciones, (ev) => send('descarga:evento', ev));
  try {
    return await descargaActual.ejecutar();
  } finally {
    descargaActual = null;
  }
});

handle('descarga:cancelar', async () => {
  if (descargaActual) descargaActual.cancelar();
  return true;
});

// Biblioteca local
function contribPorId(id) {
  const c = store.get().contribuyentes.find((x) => x.id === id);
  if (!c) throw new Error('Selecciona un contribuyente.');
  return c;
}

handle('facturas:listar', async ({ contribuyenteId, filtros, limite = 500 }) => {
  const c = contribPorId(contribuyenteId);
  const rows = filtrar(Object.values(store.readIndex(c.rfc)), filtros || {}).sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  const suma = (k) => Math.round(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0) * 100) / 100;
  return {
    total: rows.length,
    sumaTotal: suma('totalMXN'),
    sumaIva: suma('iva16') + suma('iva8'),
    filas: rows.slice(0, limite),
  };
});

handle('facturas:excel', async ({ contribuyenteId, filtros, uuids }) => {
  requiereAcceso();
  const c = contribPorId(contribuyenteId);
  let rows = filtrar(Object.values(store.readIndex(c.rfc)), filtros || {});
  if (uuids && uuids.length) {
    const s = new Set(uuids);
    rows = rows.filter((r) => s.has(r.uuid));
  }
  if (!rows.length) throw new Error('No hay facturas con esos filtros.');
  rows.sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
  const file = await exportarExcel(c.rfc, rows, filtros || {}, (p) => send('descarga:evento', { tipo: 'progreso', ...p }));
  shell.openPath(file);
  return file;
});

handle('facturas:pdf', async ({ contribuyenteId, uuids }) => {
  requiereAcceso();
  const c = contribPorId(contribuyenteId);
  const index = store.readIndex(c.rfc);
  const rows = uuids.map((u) => index[u]).filter(Boolean);
  const d = new Descarga({}, (ev) => send('descarga:evento', ev));
  d.index = index;
  await d.generarPdfs(rows);
  store.writeIndex(c.rfc, index);
  if (rows.length === 1 && rows[0].archivoPdf) shell.openPath(rows[0].archivoPdf);
  return rows.filter((r) => r.archivoPdf).length;
});

handle('facturas:importar', async (contribuyenteId) => {
  requiereAcceso();
  const c = contribPorId(contribuyenteId);
  const r = await dialog.showOpenDialog(win, { title: 'Carpeta con tus XML o ZIP', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return 0;
  return importarCarpeta(c.rfc, r.filePaths[0]);
});

handle('abrir:ruta', async (p) => {
  if (p && fs.existsSync(p)) return shell.openPath(p);
  throw new Error('El archivo ya no existe.');
});
handle('abrir:carpetaRfc', async (id) => {
  const dir = carpetaRfc(contribPorId(id).rfc);
  fs.mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
});
handle('abrir:externo', async (url) => abrirExterno(url));
handle('portapapeles', async (texto) => clipboard.writeText(String(texto)));

// ---------- Arranque ----------
app.whenReady().then(() => {
  crearVentana();
  iniciarActualizaciones();
});

app.on('window-all-closed', () => app.quit());
