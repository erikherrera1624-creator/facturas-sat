// Genera el Excel con las columnas que eligio el usuario.
const fs = require('fs');
const ExcelJS = require('exceljs');
const { COLUMNAS } = require('./columnas');
const { parseCfdi } = require('./parser');

const DORADO = 'FFB8912F';
const DORADO_CLARO = 'FFF7EFD9';

function toExcelDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?/.exec(s || '');
  if (!m) return s || '';
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)));
}

function colLetter(n) {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function styleHeader(row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DORADO } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  row.height = 30;
}

function formatFor(tipo) {
  if (tipo === 'dinero') return '$#,##0.00;[Red]-$#,##0.00';
  if (tipo === 'numero') return '#,##0.####';
  if (tipo === 'fecha') return 'dd/mm/yyyy hh:mm';
  return undefined;
}

function valueFor(col, row) {
  const v = row[col.key];
  if (col.tipo === 'fecha') return toExcelDate(v);
  if (col.key === 'mes') return (row.fecha || '').slice(0, 7);
  return v === undefined || v === null ? '' : v;
}

/**
 * rows: filas del indice. opciones: { columnas: [keys], hojaConceptos, hojaPagos, titulo }
 */
async function generarExcel(filePath, rows, opciones, onProgress = () => {}) {
  const keys = opciones.columnas && opciones.columnas.length ? opciones.columnas : ['uuid', 'fecha', 'total'];
  const cols = keys.map((k) => COLUMNAS.find((c) => c.key === k)).filter(Boolean);

  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: filePath, useStyles: true, useSharedStrings: false });
  wb.creator = 'Facturas SAT';
  wb.created = new Date();

  // ---- Hoja principal ----
  const ws = wb.addWorksheet('Facturas', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = cols.map((c) => ({
    header: c.label,
    key: c.key,
    width: c.ancho || Math.max(14, Math.min(40, c.label.length + 4)),
    ...(formatFor(c.tipo) ? { style: { numFmt: formatFor(c.tipo) } } : {}),
  }));
  styleHeader(ws.getRow(1));
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };

  let i = 0;
  for (const r of rows) {
    const values = {};
    for (const c of cols) values[c.key] = valueFor(c, r);
    const excelRow = ws.addRow(values);
    const xmlIdx = keys.indexOf('archivoXml');
    if (xmlIdx >= 0 && r.archivoXml) {
      excelRow.getCell(xmlIdx + 1).value = { text: r.archivoXml, hyperlink: 'file:///' + r.archivoXml.replace(/\\/g, '/') };
    }
    const pdfIdx = keys.indexOf('archivoPdf');
    if (pdfIdx >= 0 && r.archivoPdf) {
      excelRow.getCell(pdfIdx + 1).value = { text: r.archivoPdf, hyperlink: 'file:///' + r.archivoPdf.replace(/\\/g, '/') };
    }
    excelRow.commit();
    if (++i % 2000 === 0) onProgress({ fase: 'Excel', hechas: i, total: rows.length });
  }

  // Fila de totales (SUBTOTAL respeta los filtros de Excel)
  const last = rows.length + 1;
  const totalVals = {};
  cols.forEach((c, idx) => {
    if (idx === 0) totalVals[c.key] = 'TOTAL';
    else if (c.suma && rows.length) {
      const L = colLetter(idx + 1);
      totalVals[c.key] = { formula: `SUBTOTAL(9,${L}2:${L}${last})` };
    }
  });
  const tr = ws.addRow(totalVals);
  tr.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DORADO_CLARO } };
  });
  tr.commit();
  ws.commit();

  // ---- Hojas de detalle (leen de nuevo los XML) ----
  if (opciones.hojaConceptos || opciones.hojaPagos) {
    const wc = opciones.hojaConceptos
      ? wb.addWorksheet('Conceptos', { views: [{ state: 'frozen', ySplit: 1 }] })
      : null;
    const wp = opciones.hojaPagos ? wb.addWorksheet('Pagos (PPD)', { views: [{ state: 'frozen', ySplit: 1 }] }) : null;

    if (wc) {
      wc.columns = [
        { header: 'Folio fiscal (UUID)', key: 'uuid', width: 38 },
        { header: 'Fecha', key: 'fecha', width: 18, style: { numFmt: 'dd/mm/yyyy' } },
        { header: 'Emisor', key: 'emisor', width: 30 },
        { header: 'Receptor', key: 'receptor', width: 30 },
        { header: 'Clave prod/serv', key: 'claveProdServ', width: 14 },
        { header: 'No. identificación', key: 'noIdentificacion', width: 16 },
        { header: 'Cantidad', key: 'cantidad', width: 10 },
        { header: 'Clave unidad', key: 'claveUnidad', width: 10 },
        { header: 'Unidad', key: 'unidad', width: 12 },
        { header: 'Descripción', key: 'descripcion', width: 60 },
        { header: 'Valor unitario', key: 'valorUnitario', width: 16, style: { numFmt: '$#,##0.00' } },
        { header: 'Descuento', key: 'descuento', width: 14, style: { numFmt: '$#,##0.00' } },
        { header: 'Importe', key: 'importe', width: 16, style: { numFmt: '$#,##0.00' } },
      ];
      styleHeader(wc.getRow(1));
    }
    if (wp) {
      wp.columns = [
        { header: 'UUID del pago', key: 'uuidPago', width: 38 },
        { header: 'Fecha del pago', key: 'fechaPago', width: 18, style: { numFmt: 'dd/mm/yyyy' } },
        { header: 'Emisor', key: 'emisor', width: 30 },
        { header: 'Forma de pago', key: 'forma', width: 12 },
        { header: 'Moneda', key: 'moneda', width: 8 },
        { header: 'Monto del pago', key: 'monto', width: 16, style: { numFmt: '$#,##0.00' } },
        { header: 'UUID factura pagada', key: 'uuidDoc', width: 38 },
        { header: 'Serie-Folio', key: 'serieFolio', width: 14 },
        { header: 'Parcialidad', key: 'parcialidad', width: 10 },
        { header: 'Saldo anterior', key: 'saldoAnt', width: 16, style: { numFmt: '$#,##0.00' } },
        { header: 'Importe pagado', key: 'pagado', width: 16, style: { numFmt: '$#,##0.00' } },
        { header: 'Saldo insoluto', key: 'insoluto', width: 16, style: { numFmt: '$#,##0.00' } },
      ];
      styleHeader(wp.getRow(1));
    }

    let j = 0;
    for (const r of rows) {
      if (++j % 1000 === 0) onProgress({ fase: 'Detalle', hechas: j, total: rows.length });
      const needConceptos = wc && r.numConceptos > 0;
      const needPagos = wp && r.tipoComprobante === 'P';
      if (!needConceptos && !needPagos) continue;
      if (!r.archivoXml || !fs.existsSync(r.archivoXml)) continue;
      let p;
      try {
        p = parseCfdi(fs.readFileSync(r.archivoXml, 'utf8'));
      } catch (_) {
        continue;
      }
      if (needConceptos) {
        for (const k of p._conceptos) {
          wc.addRow({
            uuid: r.uuid,
            fecha: toExcelDate(r.fecha),
            emisor: r.nombreEmisor || r.rfcEmisor,
            receptor: r.nombreReceptor || r.rfcReceptor,
            ...k,
          }).commit();
        }
      }
      if (needPagos) {
        for (const pg of p._pagos) {
          for (const d of pg.documentos) {
            wp.addRow({
              uuidPago: r.uuid,
              fechaPago: toExcelDate(pg.fechaPago),
              emisor: r.nombreEmisor || r.rfcEmisor,
              forma: pg.formaDePago,
              moneda: pg.moneda,
              monto: pg.monto,
              uuidDoc: d.uuid,
              serieFolio: [d.serie, d.folio].filter(Boolean).join('-'),
              parcialidad: d.numParcialidad,
              saldoAnt: d.saldoAnterior,
              pagado: d.pagado,
              insoluto: d.saldoInsoluto,
            }).commit();
          }
        }
      }
    }
    if (wc) wc.commit();
    if (wp) wp.commit();
  }

  await wb.commit();
  onProgress({ fase: 'Excel', hechas: rows.length, total: rows.length });
  return filePath;
}

module.exports = { generarExcel };
