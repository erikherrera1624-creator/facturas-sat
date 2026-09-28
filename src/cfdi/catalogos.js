// Catalogos del SAT (los mas usados) para mostrar descripciones legibles.
const TIPO_COMPROBANTE = {
  I: 'Ingreso',
  E: 'Egreso (Nota de crédito)',
  T: 'Traslado',
  N: 'Nómina',
  P: 'Pago',
};

const FORMA_PAGO = {
  '01': 'Efectivo',
  '02': 'Cheque nominativo',
  '03': 'Transferencia electrónica',
  '04': 'Tarjeta de crédito',
  '05': 'Monedero electrónico',
  '06': 'Dinero electrónico',
  '08': 'Vales de despensa',
  '12': 'Dación en pago',
  '13': 'Pago por subrogación',
  '14': 'Pago por consignación',
  '15': 'Condonación',
  '17': 'Compensación',
  '23': 'Novación',
  '24': 'Confusión',
  '25': 'Remisión de deuda',
  '26': 'Prescripción o caducidad',
  '27': 'A satisfacción del acreedor',
  '28': 'Tarjeta de débito',
  '29': 'Tarjeta de servicios',
  '30': 'Aplicación de anticipos',
  '31': 'Intermediario pagos',
  '99': 'Por definir',
};

const METODO_PAGO = {
  PUE: 'Pago en una sola exhibición',
  PPD: 'Pago en parcialidades o diferido',
};

const USO_CFDI = {
  G01: 'Adquisición de mercancías',
  G02: 'Devoluciones, descuentos o bonificaciones',
  G03: 'Gastos en general',
  I01: 'Construcciones',
  I02: 'Mobiliario y equipo de oficina',
  I03: 'Equipo de transporte',
  I04: 'Equipo de cómputo',
  I05: 'Dados, troqueles, moldes',
  I06: 'Comunicaciones telefónicas',
  I07: 'Comunicaciones satelitales',
  I08: 'Otra maquinaria y equipo',
  D01: 'Honorarios médicos y dentales',
  D02: 'Gastos médicos por incapacidad',
  D03: 'Gastos funerales',
  D04: 'Donativos',
  D05: 'Intereses de créditos hipotecarios',
  D06: 'Aportaciones voluntarias SAR',
  D07: 'Primas de seguros de gastos médicos',
  D08: 'Transportación escolar',
  D09: 'Depósitos para el ahorro',
  D10: 'Servicios educativos (colegiaturas)',
  S01: 'Sin efectos fiscales',
  CP01: 'Pagos',
  CN01: 'Nómina',
  P01: 'Por definir',
};

const REGIMEN_FISCAL = {
  601: 'General de Ley Personas Morales',
  603: 'Personas Morales con Fines no Lucrativos',
  605: 'Sueldos y Salarios',
  606: 'Arrendamiento',
  607: 'Enajenación o Adquisición de Bienes',
  608: 'Demás ingresos',
  610: 'Residentes en el Extranjero',
  611: 'Dividendos',
  612: 'Personas Físicas con Actividades Empresariales y Profesionales',
  614: 'Ingresos por intereses',
  615: 'Obtención de premios',
  616: 'Sin obligaciones fiscales',
  620: 'Sociedades Cooperativas de Producción',
  621: 'Incorporación Fiscal',
  622: 'Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras',
  623: 'Opcional para Grupos de Sociedades',
  624: 'Coordinados',
  625: 'Plataformas Tecnológicas',
  626: 'Régimen Simplificado de Confianza',
};

const TIPO_RELACION = {
  '01': 'Nota de crédito',
  '02': 'Nota de débito',
  '03': 'Devolución de mercancía',
  '04': 'Sustitución de CFDI previos',
  '05': 'Traslados de mercancías facturados',
  '06': 'Factura por traslados previos',
  '07': 'Aplicación de anticipo',
};

function desc(catalogo, clave) {
  if (!clave) return '';
  const d = catalogo[clave];
  return d ? `${clave} - ${d}` : String(clave);
}

module.exports = { TIPO_COMPROBANTE, FORMA_PAGO, METODO_PAGO, USO_CFDI, REGIMEN_FISCAL, TIPO_RELACION, desc };
