// Convierte el XML de una factura (CFDI 3.3 / 4.0) en un objeto facil de usar.
const { XMLParser } = require('fast-xml-parser');
const cat = require('./catalogos');

const ARRAYS = new Set([
  'Concepto',
  'Traslado',
  'Retencion',
  'Pago',
  'DoctoRelacionado',
  'CfdiRelacionados',
  'CfdiRelacionado',
  'Complemento',
  'Percepcion',
  'Deduccion',
  'OtroPago',
  'RetencionesLocales',
  'TrasladosLocales',
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  removeNSPrefix: true,
  parseAttributeValue: false,
  parseTagValue: false,
  isArray: (name) => ARRAYS.has(name),
});

const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const num = (x) => {
  const n = parseFloat(x);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n) => Math.round(n * 100) / 100;

function findComplemento(comp, name) {
  for (const c of arr(comp.Complemento)) {
    if (c && c[name]) return c[name];
  }
  return null;
}

function parseCfdi(xmlText) {
  const doc = parser.parse(xmlText);
  const c = doc.Comprobante;
  if (!c) throw new Error('El archivo no es una factura CFDI.');

  const emisor = c.Emisor || {};
  const receptor = c.Receptor || {};
  const tfd = findComplemento(c, 'TimbreFiscalDigital') || {};
  const tipo = c.TipoDeComprobante || '';

  // Impuestos globales
  const imp = c.Impuestos || {};
  const traslados = arr(imp.Traslados && imp.Traslados.Traslado);
  const retenciones = arr(imp.Retenciones && imp.Retenciones.Retencion);
  let iva16 = 0, iva8 = 0, iva0Base = 0, ivaExentoBase = 0, iepsTras = 0, ivaTrasBase16 = 0, ivaTrasBase8 = 0;
  for (const t of traslados) {
    const tasa = num(t.TasaOCuota);
    if (t.Impuesto === '002') {
      if (t.TipoFactor === 'Exento') ivaExentoBase += num(t.Base);
      else if (tasa === 0) iva0Base += num(t.Base);
      else if (Math.abs(tasa - 0.08) < 0.0001) { iva8 += num(t.Importe); ivaTrasBase8 += num(t.Base); }
      else { iva16 += num(t.Importe); ivaTrasBase16 += num(t.Base); }
    } else if (t.Impuesto === '003') iepsTras += num(t.Importe);
  }
  let isrRet = 0, ivaRet = 0, iepsRet = 0;
  for (const r of retenciones) {
    if (r.Impuesto === '001') isrRet += num(r.Importe);
    else if (r.Impuesto === '002') ivaRet += num(r.Importe);
    else if (r.Impuesto === '003') iepsRet += num(r.Importe);
  }

  // Impuestos locales
  const implocal = findComplemento(c, 'ImpuestosLocales');

  // Conceptos
  const conceptos = arr(c.Conceptos && c.Conceptos.Concepto).map((k) => ({
    claveProdServ: k.ClaveProdServ || '',
    noIdentificacion: k.NoIdentificacion || '',
    cantidad: num(k.Cantidad),
    claveUnidad: k.ClaveUnidad || '',
    unidad: k.Unidad || '',
    descripcion: k.Descripcion || '',
    valorUnitario: num(k.ValorUnitario),
    importe: num(k.Importe),
    descuento: num(k.Descuento),
    objetoImp: k.ObjetoImp || '',
  }));

  // Relacionados
  const relaciones = arr(c.CfdiRelacionados);
  const relTipos = relaciones.map((r) => r.TipoRelacion).filter(Boolean);
  const relUuids = relaciones.flatMap((r) => arr(r.CfdiRelacionado).map((x) => x.UUID)).filter(Boolean);

  // Complemento de pago (1.0 y 2.0)
  const pagosNode = findComplemento(c, 'Pagos');
  const pagos = arr(pagosNode && pagosNode.Pago).map((p) => ({
    fechaPago: p.FechaPago || '',
    formaDePago: p.FormaDePagoP || '',
    moneda: p.MonedaP || '',
    tipoCambio: num(p.TipoCambioP) || 1,
    monto: num(p.Monto),
    numOperacion: p.NumOperacion || '',
    documentos: arr(p.DoctoRelacionado).map((d) => ({
      uuid: (d.IdDocumento || '').toUpperCase(),
      serie: d.Serie || '',
      folio: d.Folio || '',
      moneda: d.MonedaDR || '',
      numParcialidad: d.NumParcialidad || '',
      saldoAnterior: num(d.ImpSaldoAnt),
      pagado: num(d.ImpPagado),
      saldoInsoluto: num(d.ImpSaldoInsoluto),
    })),
  }));

  // Nomina
  const nomina = findComplemento(c, 'Nomina');
  const nominaReceptor = (nomina && nomina.Receptor) || {};

  const moneda = c.Moneda || 'MXN';
  const tipoCambio = num(c.TipoCambio) || 1;
  const total = num(c.Total);

  const conceptosTexto = conceptos.map((k) => k.descripcion).join(' | ');

  return {
    uuid: String(tfd.UUID || '').toUpperCase(),
    version: c.Version || c.version || '',
    serie: c.Serie || '',
    folio: c.Folio || '',
    fecha: c.Fecha || '',
    fechaTimbrado: tfd.FechaTimbrado || '',
    tipoComprobante: tipo,
    tipoComprobanteTexto: cat.TIPO_COMPROBANTE[tipo] || tipo,
    formaPago: cat.desc(cat.FORMA_PAGO, c.FormaPago),
    formaPagoClave: c.FormaPago || '',
    metodoPago: c.MetodoPago || '',
    condicionesDePago: c.CondicionesDePago || '',
    moneda,
    tipoCambio,
    subTotal: num(c.SubTotal),
    descuento: num(c.Descuento),
    total,
    totalMXN: round2(moneda === 'MXN' || moneda === 'XXX' ? total : total * tipoCambio),
    lugarExpedicion: c.LugarExpedicion || '',
    exportacion: c.Exportacion || '',
    noCertificado: c.NoCertificado || '',

    rfcEmisor: (emisor.Rfc || '').toUpperCase(),
    nombreEmisor: emisor.Nombre || '',
    regimenEmisor: cat.desc(cat.REGIMEN_FISCAL, emisor.RegimenFiscal),

    rfcReceptor: (receptor.Rfc || '').toUpperCase(),
    nombreReceptor: receptor.Nombre || '',
    regimenReceptor: cat.desc(cat.REGIMEN_FISCAL, receptor.RegimenFiscalReceptor),
    cpReceptor: receptor.DomicilioFiscalReceptor || '',
    usoCfdi: cat.desc(cat.USO_CFDI, receptor.UsoCFDI),

    baseIva16: round2(ivaTrasBase16),
    iva16: round2(iva16),
    baseIva8: round2(ivaTrasBase8),
    iva8: round2(iva8),
    baseIva0: round2(iva0Base),
    baseIvaExento: round2(ivaExentoBase),
    iepsTrasladado: round2(iepsTras),
    totalTrasladados: num(imp.TotalImpuestosTrasladados),
    isrRetenido: round2(isrRet),
    ivaRetenido: round2(ivaRet),
    iepsRetenido: round2(iepsRet),
    totalRetenidos: num(imp.TotalImpuestosRetenidos),
    impLocalesTrasladados: implocal ? num(implocal.TotaldeTraslados) : 0,
    impLocalesRetenidos: implocal ? num(implocal.TotaldeRetenciones) : 0,

    tipoRelacion: relTipos.map((t) => cat.desc(cat.TIPO_RELACION, t)).join(', '),
    uuidsRelacionados: relUuids.join(', '),

    numConceptos: conceptos.length,
    conceptosTexto: conceptosTexto.length > 1000 ? conceptosTexto.slice(0, 1000) + '…' : conceptosTexto,
    claveProdServ: [...new Set(conceptos.map((k) => k.claveProdServ))].join(', '),

    pagoFecha: pagos.map((p) => p.fechaPago).join(', '),
    pagoMonto: round2(pagos.reduce((s, p) => s + p.monto, 0)),
    pagoForma: [...new Set(pagos.map((p) => cat.desc(cat.FORMA_PAGO, p.formaDePago)))].join(', '),
    pagoDocumentos: pagos.flatMap((p) => p.documentos.map((d) => d.uuid)).join(', '),
    pagoParcialidades: pagos.flatMap((p) => p.documentos.map((d) => d.numParcialidad)).join(', '),
    pagoSaldoInsoluto: round2(pagos.reduce((s, p) => s + p.documentos.reduce((a, d) => a + d.saldoInsoluto, 0), 0)),

    nominaFechaPago: nomina ? nomina.FechaPago || '' : '',
    nominaPeriodo: nomina ? `${nomina.FechaInicialPago || ''} a ${nomina.FechaFinalPago || ''}` : '',
    nominaPercepciones: nomina ? num(nomina.TotalPercepciones) : 0,
    nominaDeducciones: nomina ? num(nomina.TotalDeducciones) : 0,
    nominaOtrosPagos: nomina ? num(nomina.TotalOtrosPagos) : 0,
    nominaCurp: nominaReceptor.Curp || '',
    nominaNumEmpleado: nominaReceptor.NumEmpleado || '',

    rfcProvCertif: tfd.RfcProvCertif || '',
    noCertificadoSAT: tfd.NoCertificadoSAT || '',
    selloCFD: tfd.SelloCFD || c.Sello || '',
    selloSAT: tfd.SelloSAT || '',

    // Detalle (se usa para PDF y hojas extra; no se guarda en el indice)
    _conceptos: conceptos,
    _pagos: pagos,
    _emisor: emisor,
    _receptor: receptor,
  };
}

// Version ligera para guardar en el indice local.
function toIndexRow(parsed) {
  const out = {};
  for (const k of Object.keys(parsed)) if (!k.startsWith('_') && k !== 'selloSAT' && k !== 'selloCFD') out[k] = parsed[k];
  return out;
}

module.exports = { parseCfdi, toIndexRow };
