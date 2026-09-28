// Orquesta la descarga masiva: divide el periodo por meses, hace todas las solicitudes
// al SAT en paralelo, espera a que esten listas, descarga los paquetes, guarda los XML,
// crea los PDF y arma el Excel.
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const store = require('./store');
const { Fiel } = require('./sat/fiel');
const { SatWebService } = require('./sat/webservice');
const { parseCfdi, toIndexRow } = require('./cfdi/parser');
const { generarExcel } = require('./cfdi/excel');
const { PRESETS } = require('./cfdi/columnas');

const VERIFICAR_CADA_MS = 15_000;
const SOLICITUD_VIGENCIA_MS = 70 * 3600_000; // el SAT guarda las solicitudes 72 h
const MAX_HTTP_SIMULTANEAS = 5;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function semaforo(max) {
  let activos = 0;
  const cola = [];
  return async function run(fn) {
    if (activos >= max) await new Promise((r) => cola.push(r));
    activos++;
    try {
      return await fn();
    } finally {
      activos--;
      const next = cola.shift();
      if (next) next();
    }
  };
}

function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Divide [desde, hasta] (YYYY-MM-DD) en rangos por mes.
function rangosMensuales(desde, hasta) {
  const out = [];
  let ini = parseYmd(desde);
  const fin = parseYmd(hasta);
  while (ini <= fin) {
    const finMes = new Date(ini.getFullYear(), ini.getMonth() + 1, 0);
    const f = finMes < fin ? finMes : fin;
    out.push({ desde: `${ymd(ini)}T00:00:00`, hasta: `${ymd(f)}T23:59:59` });
    ini = new Date(f.getFullYear(), f.getMonth(), f.getDate() + 1);
  }
  return out;
}

function partirRango(r) {
  const a = new Date(r.desde).getTime();
  const b = new Date(r.hasta).getTime();
  const mid = new Date(a + Math.floor((b - a) / 2));
  const midStr = `${ymd(mid)}T${pad(mid.getHours())}:${pad(mid.getMinutes())}:${pad(mid.getSeconds())}`;
  const next = new Date(mid.getTime() + 1000);
  const nextStr = `${ymd(next)}T${pad(next.getHours())}:${pad(next.getMinutes())}:${pad(next.getSeconds())}`;
  if (midStr >= r.hasta || nextStr > r.hasta) return null;
  return [
    { desde: r.desde, hasta: midStr },
    { desde: nextStr, hasta: r.hasta },
  ];
}

// Variantes de la fecha final para esquivar el limite de solicitudes repetidas del SAT
// (se extiende unos segundos hacia el dia siguiente; los duplicados se eliminan por UUID).
function variantesFin(hasta) {
  const d = new Date(hasta);
  const out = [hasta];
  for (let s = 1; s <= 3; s++) {
    const x = new Date(d.getTime() + s * 1000);
    out.push(`${ymd(x)}T${pad(x.getHours())}:${pad(x.getMinutes())}:${pad(x.getSeconds())}`);
  }
  return out;
}

function cargarFiel(contribuyente) {
  if (!contribuyente.cer || !contribuyente.key || !contribuyente.fielPassword) {
    throw new Error('Este RFC no tiene e.firma completa (.cer, .key y contraseña). Agrégala en "Contribuyentes".');
  }
  return new Fiel(Buffer.from(contribuyente.cer, 'base64'), Buffer.from(contribuyente.key, 'base64'), contribuyente.fielPassword);
}

function carpetaRfc(rfc) {
  return path.join(store.get().ajustes.carpetaDescargas, rfc);
}

function rutaXml(rfc, row) {
  const tipo = row.tipo === 'Emitida' ? 'Emitidas' : 'Recibidas';
  const y = (row.fecha || '0000').slice(0, 4);
  const m = (row.fecha || '0000-00').slice(5, 7);
  return path.join(carpetaRfc(rfc), tipo, y, m, `${row.uuid}.xml`);
}

// Guarda un XML en la biblioteca y lo agrega al indice. Devuelve la fila o null.
function guardarXml(rfc, index, xmlText, tipoPorDefecto) {
  let p;
  try {
    p = parseCfdi(xmlText);
  } catch (_) {
    return null;
  }
  if (!p.uuid) return null;
  const row = toIndexRow(p);
  if (row.rfcEmisor === rfc && row.rfcReceptor !== rfc) row.tipo = 'Emitida';
  else if (row.rfcReceptor === rfc && row.rfcEmisor !== rfc) row.tipo = 'Recibida';
  else row.tipo = tipoPorDefecto === 'emitidos' ? 'Emitida' : 'Recibida';
  row.mes = (row.fecha || '').slice(0, 7);

  const file = rutaXml(rfc, row);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, xmlText);
  row.archivoXml = file;
  const prev = index[row.uuid];
  if (prev && prev.archivoPdf && fs.existsSync(prev.archivoPdf)) row.archivoPdf = prev.archivoPdf;
  index[row.uuid] = row;
  return row;
}

function filtrar(rows, f) {
  const tipos = new Set(f.tipos || []);
  const tcs = new Set(f.tiposComprobante || []);
  const mps = new Set(f.metodosPago || []);
  const uuids = new Set((f.uuids || []).map((u) => u.toUpperCase()));
  const texto = (f.texto || '').trim().toUpperCase();
  const desde = f.desde ? f.desde + 'T00:00:00' : '';
  const hasta = f.hasta ? f.hasta + 'T23:59:59' : '';
  return rows.filter((r) => {
    if (tipos.size && !tipos.has(r.tipo === 'Emitida' ? 'emitidos' : 'recibidos')) return false;
    if (uuids.size) return uuids.has(r.uuid);
    if (desde && r.fecha < desde) return false;
    if (hasta && r.fecha > hasta) return false;
    if (tcs.size && !tcs.has(r.tipoComprobante)) return false;
    if (mps.size && !mps.has(r.metodoPago)) return false;
    if (texto) {
      const hay = `${r.uuid} ${r.rfcEmisor} ${r.nombreEmisor} ${r.rfcReceptor} ${r.nombreReceptor} ${r.serie}${r.folio} ${r.folio}`.toUpperCase();
      if (!hay.includes(texto)) return false;
    }
    return true;
  });
}

class Descarga {
  constructor(opciones, emit) {
    this.o = opciones;
    this.emit = emit;
    this.cancelado = false;
    this.http = semaforo(MAX_HTTP_SIMULTANEAS);
    this.trabajos = [];
    this.nuevas = 0;
  }

  cancelar() {
    this.cancelado = true;
  }

  log(mensaje) {
    this.emit({ tipo: 'log', mensaje });
  }

  estado() {
    this.emit({
      tipo: 'estado',
      trabajos: this.trabajos.map((t) => ({ id: t.id, etiqueta: t.etiqueta, estado: t.estado, cfdis: t.cfdis })),
      nuevas: this.nuevas,
    });
  }

  async ejecutar() {
    const o = this.o;
    const data = store.get();
    const contrib = data.contribuyentes.find((c) => c.id === o.contribuyenteId);
    if (!contrib) throw new Error('Selecciona un contribuyente.');
    const rfc = contrib.rfc;

    this.log('Leyendo e.firma…');
    const fiel = cargarFiel(contrib);
    if (fiel.rfc !== rfc) throw new Error(`La e.firma es del RFC ${fiel.rfc}, no de ${rfc}.`);
    if (!fiel.isValidNow()) throw new Error('La e.firma está vencida. Renuévala en el SAT.');
    this.ws = new SatWebService(fiel);

    this.log('Iniciando sesión en el SAT…');
    await this.http(() => this.ws.getToken());
    this.log('Sesión iniciada. Enviando solicitudes…');

    this.rfc = rfc;
    this.index = store.readIndex(rfc);
    this.solicitudes = store.readSolicitudes(rfc);

    // Armar trabajos
    const uuids = (o.uuids || []).map((u) => u.trim().toUpperCase()).filter(Boolean);
    if (uuids.length) {
      for (const u of uuids) {
        if (this.index[u] && !o.forzar) continue;
        this.trabajos.push({ id: `F|${u}`, etiqueta: `Folio ${u.slice(0, 8)}…`, folio: u, estado: 'Pendiente', cfdis: 0 });
      }
    } else {
      const tc = (o.tiposComprobante || []).length === 1 ? o.tiposComprobante[0] : '';
      for (const tipo of o.tipos) {
        for (const r of rangosMensuales(o.desde, o.hasta)) {
          this.trabajos.push(this.nuevoTrabajo(tipo, r, tc));
        }
      }
    }
    this.estado();

    await Promise.all(this.trabajos.map((t) => this.correrTrabajo(t)));
    store.writeIndex(rfc, this.index);
    if (this.cancelado) throw new Error('Descarga cancelada.');

    const fallidos = this.trabajos.filter((t) => t.estado.startsWith('Error'));

    // Resultado filtrado
    let rows = filtrar(Object.values(this.index), { ...o, uuids });
    rows.sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
    this.log(`${rows.length} facturas cumplen tus filtros.`);

    if (o.generarPdf && rows.length) await this.generarPdfs(rows);
    store.writeIndex(rfc, this.index);

    let excel = null;
    if (o.generarExcel !== false && rows.length) {
      excel = await exportarExcel(rfc, rows, o, (p) => this.emit({ tipo: 'progreso', ...p }));
    }
    return {
      total: rows.length,
      nuevas: this.nuevas,
      excel,
      carpeta: carpetaRfc(rfc),
      errores: fallidos.map((t) => `${t.etiqueta}: ${t.estado}`),
    };
  }

  nuevoTrabajo(tipo, r, tc) {
    const mes = r.desde.slice(0, 7);
    const dia = r.desde.slice(8, 10) !== '01' || !r.hasta.startsWith(mes) ? ` (${r.desde.slice(5, 10)} a ${r.hasta.slice(5, 10)})` : '';
    return {
      id: `${tipo}|${r.desde}|${r.hasta}|${tc}`,
      etiqueta: `${tipo === 'emitidos' ? 'Emitidas' : 'Recibidas'} ${mes}${dia}`,
      tipo,
      rango: r,
      tc,
      estado: 'Pendiente',
      cfdis: 0,
    };
  }

  guardarSolicitudes() {
    store.writeSolicitudes(this.rfc, this.solicitudes);
  }

  set(t, estado, cfdis) {
    t.estado = estado;
    if (cfdis !== undefined) t.cfdis = cfdis;
    this.estado();
  }

  // Si este periodo ya se descargó completo después de que terminó, no hace falta pedirlo otra vez.
  yaCompleto(t) {
    if (this.o.forzar || !t.rango) return false;
    const ids = [t.id, `${t.tipo}|${t.rango.desde}|${t.rango.hasta}|`];
    const finPeriodo = new Date(t.rango.hasta).getTime();
    return ids.some((id) => {
      const s = this.solicitudes[id];
      return s && s.completadoEn && s.completadoEn > finPeriodo + 4 * 86400_000;
    });
  }

  async correrTrabajo(t) {
    try {
      if (this.yaCompleto(t)) {
        const n = this.solicitudes[t.id]?.cfdis ?? 0;
        this.set(t, 'Ya descargado', n);
        return;
      }
      await this.procesar(t);
    } catch (err) {
      this.set(t, 'Error: ' + err.message);
    }
  }

  async procesar(t) {
    if (this.cancelado) return;
    let sol = this.solicitudes[t.id];
    const vigente = sol && sol.idSolicitud && !sol.completadoEn && Date.now() - sol.creadoEn < SOLICITUD_VIGENCIA_MS;

    let idSolicitud = vigente ? sol.idSolicitud : null;
    if (!idSolicitud) {
      this.set(t, 'Solicitando');
      const r = await this.solicitar(t);
      if (r === 'sin-datos') {
        this.solicitudes[t.id] = { completadoEn: Date.now(), cfdis: 0 };
        this.guardarSolicitudes();
        return this.set(t, 'Sin facturas', 0);
      }
      if (r === 'partir') return this.partir(t);
      idSolicitud = r;
      this.solicitudes[t.id] = { idSolicitud, creadoEn: Date.now() };
      this.guardarSolicitudes();
    }

    // Esperar a que el SAT la prepare
    this.set(t, 'SAT preparando');
    let v;
    for (;;) {
      if (this.cancelado) return;
      v = await this.http(() => this.ws.verificar(idSolicitud));
      if (v.codigoEstado === '5004' || (v.estado === 3 && v.numeroCfdis === 0)) {
        this.solicitudes[t.id] = { completadoEn: Date.now(), cfdis: 0 };
        this.guardarSolicitudes();
        return this.set(t, 'Sin facturas', 0);
      }
      if (v.codigoEstado === '5003' && t.rango) return this.partir(t);
      if (v.estado === 3) break;
      if (v.estado === 6 || (v.estado >= 4 && v.codigoEstado === '5011')) {
        // Vencida: pedirla de nuevo
        delete this.solicitudes[t.id];
        this.guardarSolicitudes();
        return this.procesar(t);
      }
      if (v.estado >= 4) throw new Error(`${v.estadoTexto} por el SAT: ${v.mensaje || v.codigoEstado}`);
      this.set(t, v.estado === 2 ? 'SAT procesando' : 'SAT en cola', v.numeroCfdis || undefined);
      await sleep(VERIFICAR_CADA_MS);
    }

    // Descargar paquetes
    this.set(t, `Descargando 0/${v.paquetes.length}`, v.numeroCfdis);
    let hechos = 0;
    let guardadas = 0;
    await Promise.all(
      v.paquetes.map(async (idPaquete) => {
        const d = await this.http(() => this.ws.descargar(idPaquete));
        if (!d.zip) throw new Error(`No se pudo descargar un paquete (${d.codigo} ${d.mensaje})`);
        guardadas += this.procesarZip(d.zip, t.tipo);
        hechos++;
        this.set(t, `Descargando ${hechos}/${v.paquetes.length}`);
      })
    );
    this.solicitudes[t.id] = { ...this.solicitudes[t.id], completadoEn: Date.now(), cfdis: guardadas };
    this.guardarSolicitudes();
    store.writeIndex(this.rfc, this.index);
    this.set(t, 'Listo', guardadas);
  }

  async solicitar(t) {
    if (t.folio) {
      const r = await this.http(() => this.ws.solicitarPorFolio(t.folio));
      if (r.codigo === '5000' && r.idSolicitud) return r.idSolicitud;
      if (r.codigo === '5004') return 'sin-datos';
      throw new Error(r.mensaje || r.codigo);
    }
    let ultimo;
    for (const hasta of variantesFin(t.rango.hasta)) {
      const r = await this.http(() =>
        this.ws.solicitar({
          tipo: t.tipo,
          desde: t.rango.desde,
          hasta,
          tipoComprobante: t.tc,
          // El SAT solo entrega XML de recibidas vigentes.
          estado: t.tipo === 'recibidos' ? 'Vigente' : this.o.soloVigentes ? 'Vigente' : '',
        })
      );
      if (r.codigo === '5000' && r.idSolicitud) return r.idSolicitud;
      if (r.codigo === '5004') return 'sin-datos';
      if (r.codigo === '5003') return 'partir';
      ultimo = r;
      // 5002: se agotaron solicitudes de por vida para este periodo; 5005: duplicada.
      if (r.codigo !== '5002' && r.codigo !== '5005') break;
    }
    throw new Error(`${ultimo.mensaje || 'Solicitud rechazada'} (${ultimo.codigo})`);
  }

  async partir(t) {
    const partes = partirRango(t.rango);
    if (!partes) throw new Error('El SAT indica demasiadas facturas en un periodo muy corto.');
    this.set(t, 'Dividido en partes más chicas');
    const hijos = partes.map((r) => this.nuevoTrabajo(t.tipo, r, t.tc));
    this.trabajos.push(...hijos);
    this.estado();
    await Promise.all(hijos.map((h) => this.correrTrabajo(h)));
    const suma = hijos.reduce((s, h) => s + (h.cfdis || 0), 0);
    this.set(t, hijos.some((h) => h.estado.startsWith('Error')) ? 'Error en una parte' : 'Listo', suma);
  }

  procesarZip(buffer, tipo) {
    const zip = new AdmZip(buffer);
    let n = 0;
    for (const e of zip.getEntries()) {
      if (e.isDirectory || !/\.xml$/i.test(e.entryName)) continue;
      const existia = !!this.index[path.basename(e.entryName, '.xml').toUpperCase()];
      const row = guardarXml(this.rfc, this.index, e.getData().toString('utf8'), tipo);
      if (row) {
        n++;
        if (!existia) this.nuevas++;
      }
    }
    this.estado();
    return n;
  }

  async generarPdfs(rows) {
    const faltan = rows.filter((r) => !(r.archivoPdf && fs.existsSync(r.archivoPdf)) && r.archivoXml && fs.existsSync(r.archivoXml));
    if (!faltan.length) return;
    const { PdfMaker } = require('./cfdi/pdf');
    const maker = new PdfMaker(4);
    let hechos = 0;
    try {
      await Promise.all(
        faltan.map(async (r) => {
          if (this.cancelado) return;
          try {
            const p = parseCfdi(fs.readFileSync(r.archivoXml, 'utf8'));
            const out = r.archivoXml.replace(/\.xml$/i, '.pdf');
            await maker.make(p, out);
            r.archivoPdf = out;
            if (this.index[r.uuid]) this.index[r.uuid].archivoPdf = out;
          } catch (_) {}
          hechos++;
          if (hechos % 10 === 0 || hechos === faltan.length) {
            this.emit({ tipo: 'progreso', fase: 'PDF', hechas: hechos, total: faltan.length });
          }
        })
      );
    } finally {
      maker.close();
    }
  }
}

async function exportarExcel(rfc, rows, o, onProgress, destino) {
  const aj = store.get().ajustes;
  const columnas = o.columnas || aj.columnas || PRESETS.contable;
  const nombre = `Facturas_${rfc}_${o.desde || 'todas'}_a_${o.hasta || 'hoy'}_${Date.now().toString().slice(-5)}.xlsx`;
  const file = destino || path.join(carpetaRfc(rfc), 'Excel', nombre);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await generarExcel(file, rows, {
    columnas,
    hojaConceptos: o.hojaConceptos ?? aj.hojaConceptos,
    hojaPagos: o.hojaPagos ?? aj.hojaPagos,
  }, onProgress);
  return file;
}

// Importa XML que el usuario ya tenga en una carpeta.
function importarCarpeta(rfc, carpeta) {
  const index = store.readIndex(rfc);
  let n = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.xml$/i.test(e.name)) {
        if (guardarXml(rfc, index, fs.readFileSync(p, 'utf8'), 'recibidos')) n++;
      } else if (/\.zip$/i.test(e.name)) {
        try {
          for (const z of new AdmZip(p).getEntries()) {
            if (!z.isDirectory && /\.xml$/i.test(z.entryName) && guardarXml(rfc, index, z.getData().toString('utf8'), 'recibidos')) n++;
          }
        } catch (_) {}
      }
    }
  };
  walk(carpeta);
  store.writeIndex(rfc, index);
  return n;
}

module.exports = { Descarga, filtrar, exportarExcel, importarCarpeta, cargarFiel, carpetaRfc };
