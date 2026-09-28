// Crea el PDF (representacion impresa) de cada factura a partir de su XML.
// El SAT solo entrega XML; el PDF se arma aqui con el mismo contenido.
const fs = require('fs');
const QRCode = require('qrcode');
const cat = require('./catalogos');

const h = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (n) =>
  Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2 });

// ---- Importe con letra ----
const U = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE', 'VEINTIÚN', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO', 'VEINTICINCO', 'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
const D = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const C = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

function cientos(n) {
  if (n === 100) return 'CIEN';
  const c = Math.floor(n / 100);
  const r = n % 100;
  let t = C[c];
  if (r) {
    const dec = r < 30 ? U[r] : D[Math.floor(r / 10)] + (r % 10 ? ' Y ' + U[r % 10] : '');
    t = (t ? t + ' ' : '') + dec;
  }
  return t;
}

function enLetras(n) {
  if (n === 0) return 'CERO';
  const partes = [];
  const millones = Math.floor(n / 1e6);
  const miles = Math.floor((n % 1e6) / 1000);
  const resto = n % 1000;
  if (millones) partes.push(millones === 1 ? 'UN MILLÓN' : enLetras(millones) + ' MILLONES');
  if (miles) partes.push(miles === 1 ? 'MIL' : cientos(miles) + ' MIL');
  if (resto) partes.push(cientos(resto));
  return partes.join(' ');
}

function importeConLetra(total, moneda) {
  const entero = Math.floor(total);
  const cent = Math.round((total - entero) * 100);
  const nombre = moneda === 'USD' ? 'DÓLARES' : moneda === 'EUR' ? 'EUROS' : 'PESOS';
  const sufijo = moneda === 'MXN' || !moneda ? 'M.N.' : moneda;
  return `${enLetras(entero)} ${nombre} ${String(cent).padStart(2, '0')}/100 ${sufijo}`;
}

async function htmlFactura(p) {
  const qrUrl =
    'https://verificacfdi.facturaelectronica.sat.gob.mx/default.aspx' +
    `?id=${p.uuid}&re=${encodeURIComponent(p.rfcEmisor)}&rr=${encodeURIComponent(p.rfcReceptor)}` +
    `&tt=${Number(p.total).toFixed(6)}&fe=${(p.selloCFD || '').slice(-8)}`;
  const qr = await QRCode.toDataURL(qrUrl, { margin: 0, width: 220 });

  const conceptos = p._conceptos
    .map(
      (k) => `<tr>
      <td>${h(k.claveProdServ)}</td><td class="n">${k.cantidad}</td><td>${h(k.claveUnidad)} ${h(k.unidad)}</td>
      <td>${h(k.descripcion)}</td><td class="n">${money(k.valorUnitario)}</td><td class="n">${money(k.importe)}</td></tr>`
    )
    .join('');

  const pagos = p._pagos.length
    ? `<h3>Complemento de pago</h3><table><thead><tr><th>Fecha pago</th><th>Forma</th><th>Factura pagada</th><th>Parc.</th><th class="n">Saldo ant.</th><th class="n">Pagado</th><th class="n">Insoluto</th></tr></thead><tbody>
    ${p._pagos
      .flatMap((pg) =>
        pg.documentos.map(
          (d) =>
            `<tr><td>${h(pg.fechaPago)}</td><td>${h(cat.desc(cat.FORMA_PAGO, pg.formaDePago))}</td><td>${h(d.uuid)}</td><td>${h(d.numParcialidad)}</td><td class="n">${money(d.saldoAnterior)}</td><td class="n">${money(d.pagado)}</td><td class="n">${money(d.saldoInsoluto)}</td></tr>`
        )
      )
      .join('')}</tbody></table>`
    : '';

  const fila = (l, v) => (v ? `<div><span>${l}</span>${h(v)}</div>` : '');
  const tot = (l, v, force) => (v || force ? `<tr><td>${l}</td><td class="n">${money(v)}</td></tr>` : '');

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box} body{font-family:'Segoe UI',Arial,sans-serif;font-size:10px;color:#2b2b2b;margin:0;padding:28px}
    .top{display:flex;justify-content:space-between;border-bottom:3px solid #b8912f;padding-bottom:12px;margin-bottom:12px}
    h1{font-size:18px;margin:0;color:#8a6a1c} h2{font-size:12px;margin:0 0 4px;color:#8a6a1c} h3{font-size:11px;color:#8a6a1c;margin:14px 0 4px}
    .box{border:1px solid #e6d8b0;border-radius:6px;padding:8px;background:#fffdf7}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px}
    .box div{margin:2px 0} .box span{display:inline-block;min-width:110px;color:#7a7a7a}
    table{width:100%;border-collapse:collapse} th{background:#b8912f;color:#fff;text-align:left;padding:5px;font-weight:600}
    td{padding:4px 5px;border-bottom:1px solid #eee;vertical-align:top} .n{text-align:right;white-space:nowrap}
    .tot{width:260px;margin-left:auto;margin-top:8px} .tot tr:last-child td{font-weight:700;border-top:2px solid #b8912f;font-size:12px}
    .letra{margin-top:6px;font-weight:600}
    .sat{display:flex;gap:12px;margin-top:14px;border-top:1px solid #e6d8b0;padding-top:10px}
    .sat img{width:110px;height:110px} .sello{word-break:break-all;font-size:7px;color:#555;margin:2px 0 6px}
    .tag{display:inline-block;background:#f7efd9;color:#8a6a1c;border-radius:10px;padding:2px 8px;font-weight:600}
  </style></head><body>
    <div class="top">
      <div><h1>${h(p.nombreEmisor || p.rfcEmisor)}</h1><div>RFC: <b>${h(p.rfcEmisor)}</b></div><div>${h(p.regimenEmisor)}</div></div>
      <div style="text-align:right"><span class="tag">${h(p.tipoComprobanteTexto)}</span>
        <div style="margin-top:6px">Serie-Folio: <b>${h([p.serie, p.folio].filter(Boolean).join('-') || '—')}</b></div>
        <div>Fecha: ${h(p.fecha)}</div><div>Lugar de expedición: ${h(p.lugarExpedicion)}</div></div>
    </div>
    <div class="grid">
      <div class="box"><h2>Receptor</h2>${fila('Nombre', p.nombreReceptor)}${fila('RFC', p.rfcReceptor)}${fila('Régimen', p.regimenReceptor)}${fila('Código postal', p.cpReceptor)}${fila('Uso CFDI', p.usoCfdi)}</div>
      <div class="box"><h2>Datos del comprobante</h2>${fila('Folio fiscal', p.uuid)}${fila('Método de pago', p.metodoPago ? cat.desc(cat.METODO_PAGO, p.metodoPago) : '')}${fila('Forma de pago', p.formaPago)}${fila('Moneda', p.moneda + (p.tipoCambio !== 1 ? ' (TC ' + p.tipoCambio + ')' : ''))}${fila('Condiciones', p.condicionesDePago)}${fila('Relación', p.tipoRelacion)}${fila('CFDI relacionados', p.uuidsRelacionados)}</div>
    </div>
    ${conceptos ? `<table><thead><tr><th>Clave</th><th class="n">Cant.</th><th>Unidad</th><th>Descripción</th><th class="n">P. unitario</th><th class="n">Importe</th></tr></thead><tbody>${conceptos}</tbody></table>` : ''}
    ${pagos}
    <table class="tot">
      ${tot('Subtotal', p.subTotal, true)}${tot('Descuento', p.descuento)}${tot('IVA 16%', p.iva16)}${tot('IVA 8%', p.iva8)}${tot('IEPS', p.iepsTrasladado)}
      ${tot('ISR retenido', p.isrRetenido)}${tot('IVA retenido', p.ivaRetenido)}${tot('Imp. locales', p.impLocalesTrasladados - p.impLocalesRetenidos)}
      ${tot('Total', p.total, true)}
    </table>
    <div class="letra">${h(importeConLetra(p.total, p.moneda))}</div>
    <div class="sat"><img src="${qr}"><div style="flex:1">
      <div>Fecha de timbrado: <b>${h(p.fechaTimbrado)}</b> · No. certificado SAT: <b>${h(p.noCertificadoSAT)}</b> · PAC: <b>${h(p.rfcProvCertif)}</b></div>
      <h3>Sello digital del CFDI</h3><div class="sello">${h(p.selloCFD)}</div>
      <h3>Sello del SAT</h3><div class="sello">${h(p.selloSAT)}</div>
      <div style="color:#7a7a7a">Este documento es una representación impresa de un CFDI.</div>
    </div></div>
  </body></html>`;
}

// Pool de ventanas ocultas para convertir varios PDF a la vez.
class PdfMaker {
  constructor(size = 3) {
    const { BrowserWindow } = require('electron');
    this.wins = Array.from({ length: size }, () => new BrowserWindow({ show: false, webPreferences: { javascript: false } }));
    this.free = [...this.wins];
    this.waiters = [];
  }

  async acquire() {
    if (this.free.length) return this.free.pop();
    return new Promise((r) => this.waiters.push(r));
  }

  release(w) {
    const next = this.waiters.shift();
    if (next) next(w);
    else this.free.push(w);
  }

  async make(parsed, outPath) {
    const html = await htmlFactura(parsed);
    const w = await this.acquire();
    try {
      await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      const pdf = await w.webContents.printToPDF({ pageSize: 'Letter', printBackground: true, margins: { marginType: 'none' } });
      fs.writeFileSync(outPath, pdf);
    } finally {
      this.release(w);
    }
  }

  close() {
    for (const w of this.wins) if (!w.isDestroyed()) w.destroy();
  }
}

module.exports = { PdfMaker, htmlFactura, importeConLetra };
