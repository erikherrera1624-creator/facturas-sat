// Todas las columnas que el usuario puede elegir para su Excel.
// tipo: texto | dinero | numero | fecha
const COLUMNAS = [
  // General
  { key: 'tipo', label: 'Emitida / Recibida', grupo: 'General', tipo: 'texto' },
  { key: 'uuid', label: 'Folio fiscal (UUID)', grupo: 'General', tipo: 'texto' },
  { key: 'fecha', label: 'Fecha de emisión', grupo: 'General', tipo: 'fecha' },
  { key: 'fechaTimbrado', label: 'Fecha de timbrado', grupo: 'General', tipo: 'fecha' },
  { key: 'mes', label: 'Mes', grupo: 'General', tipo: 'texto' },
  { key: 'serie', label: 'Serie', grupo: 'General', tipo: 'texto' },
  { key: 'folio', label: 'Folio', grupo: 'General', tipo: 'texto' },
  { key: 'tipoComprobanteTexto', label: 'Tipo de comprobante', grupo: 'General', tipo: 'texto' },
  { key: 'metodoPago', label: 'Método de pago (PUE/PPD)', grupo: 'General', tipo: 'texto' },
  { key: 'formaPago', label: 'Forma de pago', grupo: 'General', tipo: 'texto' },
  { key: 'condicionesDePago', label: 'Condiciones de pago', grupo: 'General', tipo: 'texto' },
  { key: 'usoCfdi', label: 'Uso del CFDI', grupo: 'General', tipo: 'texto' },
  { key: 'version', label: 'Versión CFDI', grupo: 'General', tipo: 'texto' },
  { key: 'lugarExpedicion', label: 'Lugar de expedición (CP)', grupo: 'General', tipo: 'texto' },
  { key: 'exportacion', label: 'Exportación', grupo: 'General', tipo: 'texto' },

  // Emisor
  { key: 'rfcEmisor', label: 'RFC emisor', grupo: 'Emisor', tipo: 'texto' },
  { key: 'nombreEmisor', label: 'Nombre emisor', grupo: 'Emisor', tipo: 'texto' },
  { key: 'regimenEmisor', label: 'Régimen fiscal emisor', grupo: 'Emisor', tipo: 'texto' },

  // Receptor
  { key: 'rfcReceptor', label: 'RFC receptor', grupo: 'Receptor', tipo: 'texto' },
  { key: 'nombreReceptor', label: 'Nombre receptor', grupo: 'Receptor', tipo: 'texto' },
  { key: 'regimenReceptor', label: 'Régimen fiscal receptor', grupo: 'Receptor', tipo: 'texto' },
  { key: 'cpReceptor', label: 'CP receptor', grupo: 'Receptor', tipo: 'texto' },

  // Importes
  { key: 'moneda', label: 'Moneda', grupo: 'Importes', tipo: 'texto' },
  { key: 'tipoCambio', label: 'Tipo de cambio', grupo: 'Importes', tipo: 'numero' },
  { key: 'subTotal', label: 'Subtotal', grupo: 'Importes', tipo: 'dinero', suma: true },
  { key: 'descuento', label: 'Descuento', grupo: 'Importes', tipo: 'dinero', suma: true },
  { key: 'total', label: 'Total', grupo: 'Importes', tipo: 'dinero', suma: true },
  { key: 'totalMXN', label: 'Total en MXN', grupo: 'Importes', tipo: 'dinero', suma: true },

  // Impuestos
  { key: 'baseIva16', label: 'Base IVA 16%', grupo: 'Impuestos', tipo: 'dinero', suma: true },
  { key: 'iva16', label: 'IVA 16%', grupo: 'Impuestos', tipo: 'dinero', suma: true },
  { key: 'baseIva8', label: 'Base IVA 8%', grupo: 'Impuestos', tipo: 'dinero', suma: true },
  { key: 'iva8', label: 'IVA 8%', grupo: 'Impuestos', tipo: 'dinero', suma: true },
  { key: 'baseIva0', label: 'Base IVA 0%', grupo: 'Impuestos', tipo: 'dinero', suma: true },
  { key: 'baseIvaExento', label: 'Base IVA exento', grupo: 'Impuestos', tipo: 'dinero', suma: true },
  { key: 'iepsTrasladado', label: 'IEPS trasladado', grupo: 'Impuestos', tipo: 'dinero', suma: true },
  { key: 'totalTrasladados', label: 'Total impuestos trasladados', grupo: 'Impuestos', tipo: 'dinero', suma: true },
  { key: 'isrRetenido', label: 'ISR retenido', grupo: 'Impuestos', tipo: 'dinero', suma: true },
  { key: 'ivaRetenido', label: 'IVA retenido', grupo: 'Impuestos', tipo: 'dinero', suma: true },
  { key: 'iepsRetenido', label: 'IEPS retenido', grupo: 'Impuestos', tipo: 'dinero', suma: true },
  { key: 'totalRetenidos', label: 'Total impuestos retenidos', grupo: 'Impuestos', tipo: 'dinero', suma: true },
  { key: 'impLocalesTrasladados', label: 'Impuestos locales trasladados', grupo: 'Impuestos', tipo: 'dinero', suma: true },
  { key: 'impLocalesRetenidos', label: 'Impuestos locales retenidos', grupo: 'Impuestos', tipo: 'dinero', suma: true },

  // Conceptos
  { key: 'numConceptos', label: 'Número de conceptos', grupo: 'Conceptos', tipo: 'numero' },
  { key: 'conceptosTexto', label: 'Descripción de conceptos', grupo: 'Conceptos', tipo: 'texto', ancho: 60 },
  { key: 'claveProdServ', label: 'Clave producto/servicio', grupo: 'Conceptos', tipo: 'texto' },

  // Relacionados
  { key: 'tipoRelacion', label: 'Tipo de relación', grupo: 'Relacionados', tipo: 'texto' },
  { key: 'uuidsRelacionados', label: 'UUIDs relacionados', grupo: 'Relacionados', tipo: 'texto', ancho: 40 },

  // Pagos
  { key: 'pagoFecha', label: 'Fecha del pago', grupo: 'Complemento de pago', tipo: 'texto' },
  { key: 'pagoMonto', label: 'Monto pagado', grupo: 'Complemento de pago', tipo: 'dinero', suma: true },
  { key: 'pagoForma', label: 'Forma de pago (pago)', grupo: 'Complemento de pago', tipo: 'texto' },
  { key: 'pagoDocumentos', label: 'Facturas pagadas (UUID)', grupo: 'Complemento de pago', tipo: 'texto', ancho: 40 },
  { key: 'pagoParcialidades', label: 'Núm. parcialidad', grupo: 'Complemento de pago', tipo: 'texto' },
  { key: 'pagoSaldoInsoluto', label: 'Saldo insoluto', grupo: 'Complemento de pago', tipo: 'dinero', suma: true },

  // Nomina
  { key: 'nominaFechaPago', label: 'Nómina: fecha de pago', grupo: 'Nómina', tipo: 'texto' },
  { key: 'nominaPeriodo', label: 'Nómina: periodo', grupo: 'Nómina', tipo: 'texto' },
  { key: 'nominaPercepciones', label: 'Nómina: percepciones', grupo: 'Nómina', tipo: 'dinero', suma: true },
  { key: 'nominaDeducciones', label: 'Nómina: deducciones', grupo: 'Nómina', tipo: 'dinero', suma: true },
  { key: 'nominaOtrosPagos', label: 'Nómina: otros pagos', grupo: 'Nómina', tipo: 'dinero', suma: true },
  { key: 'nominaCurp', label: 'Nómina: CURP', grupo: 'Nómina', tipo: 'texto' },
  { key: 'nominaNumEmpleado', label: 'Nómina: núm. empleado', grupo: 'Nómina', tipo: 'texto' },

  // Timbre / archivos
  { key: 'rfcProvCertif', label: 'RFC del PAC', grupo: 'Timbre y archivos', tipo: 'texto' },
  { key: 'noCertificadoSAT', label: 'No. certificado SAT', grupo: 'Timbre y archivos', tipo: 'texto' },
  { key: 'noCertificado', label: 'No. certificado emisor', grupo: 'Timbre y archivos', tipo: 'texto' },
  { key: 'archivoXml', label: 'Archivo XML', grupo: 'Timbre y archivos', tipo: 'texto', ancho: 50 },
  { key: 'archivoPdf', label: 'Archivo PDF', grupo: 'Timbre y archivos', tipo: 'texto', ancho: 50 },
];

const PRESETS = {
  basico: ['tipo', 'uuid', 'fecha', 'serie', 'folio', 'tipoComprobanteTexto', 'metodoPago', 'rfcEmisor', 'nombreEmisor', 'rfcReceptor', 'nombreReceptor', 'subTotal', 'iva16', 'total'],
  contable: [
    'tipo', 'uuid', 'fecha', 'mes', 'serie', 'folio', 'tipoComprobanteTexto', 'metodoPago', 'formaPago', 'usoCfdi',
    'rfcEmisor', 'nombreEmisor', 'rfcReceptor', 'nombreReceptor', 'moneda', 'tipoCambio',
    'subTotal', 'descuento', 'baseIva16', 'iva16', 'baseIva8', 'iva8', 'baseIva0', 'baseIvaExento', 'iepsTrasladado',
    'isrRetenido', 'ivaRetenido', 'total', 'totalMXN', 'conceptosTexto', 'uuidsRelacionados', 'pagoMonto', 'pagoDocumentos',
  ],
  completo: COLUMNAS.map((c) => c.key),
};

module.exports = { COLUMNAS, PRESETS };
