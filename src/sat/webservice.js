// Cliente del Web Service oficial de Descarga Masiva de CFDI del SAT (version 1.5).
// Usa la e.firma para autenticarse y firmar cada peticion.
const crypto = require('crypto');

const URLS = {
  auth: 'https://cfdidescargamasivasolicitud.clouda.sat.gob.mx/Autenticacion/Autenticacion.svc',
  solicita: 'https://cfdidescargamasivasolicitud.clouda.sat.gob.mx/SolicitaDescargaService.svc',
  verifica: 'https://cfdidescargamasivasolicitud.clouda.sat.gob.mx/VerificaSolicitudDescargaService.svc',
  descarga: 'https://cfdidescargamasiva.clouda.sat.gob.mx/DescargaMasivaService.svc',
};

const ACTIONS = {
  auth: 'http://DescargaMasivaTerceros.gob.mx/IAutenticacion/Autentica',
  emitidos: 'http://DescargaMasivaTerceros.sat.gob.mx/ISolicitaDescargaService/SolicitaDescargaEmitidos',
  recibidos: 'http://DescargaMasivaTerceros.sat.gob.mx/ISolicitaDescargaService/SolicitaDescargaRecibidos',
  folio: 'http://DescargaMasivaTerceros.sat.gob.mx/ISolicitaDescargaService/SolicitaDescargaFolio',
  verifica: 'http://DescargaMasivaTerceros.sat.gob.mx/IVerificaSolicitudDescargaService/VerificaSolicitudDescarga',
  descarga: 'http://DescargaMasivaTerceros.sat.gob.mx/IDescargaMasivaTercerosService/Descargar',
};

const NS_DES = 'http://DescargaMasivaTerceros.sat.gob.mx';

const ESTADOS_SOLICITUD = {
  1: 'Aceptada',
  2: 'En proceso',
  3: 'Terminada',
  4: 'Error',
  5: 'Rechazada',
  6: 'Vencida',
};

function esc(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/>/g, '&gt;');
}

function attrs(obj) {
  return Object.keys(obj)
    .filter((k) => obj[k] !== undefined && obj[k] !== null && obj[k] !== '')
    .sort()
    .map((k) => `${k}="${esc(obj[k])}"`)
    .join(' ');
}

function getAttr(xml, element, attr) {
  const el = new RegExp(`<(?:\\w+:)?${element}\\b[^>]*>`, 'i').exec(xml);
  if (!el) return '';
  const m = new RegExp(`\\b${attr}="([^"]*)"`).exec(el[0]);
  return m ? decodeEntities(m[1]) : '';
}

function getText(xml, element) {
  const m = new RegExp(`<(?:\\w+:)?${element}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${element}>`, 'i').exec(xml);
  return m ? decodeEntities(m[1].trim()) : '';
}

function getAllText(xml, element) {
  const re = new RegExp(`<(?:\\w+:)?${element}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${element}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push(decodeEntities(m[1].trim()));
  return out;
}

function decodeEntities(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#xD;/gi, '')
    .replace(/&amp;/g, '&');
}

function soapFault(xml) {
  const f = getText(xml, 'faultstring');
  return f || '';
}

class SatWebService {
  constructor(fiel, { httpPost } = {}) {
    this.fiel = fiel;
    this.httpPost = httpPost || defaultHttpPost;
    this.token = null;
    this.tokenExpires = 0;
  }

  // ---------- Firma ----------
  signature(toDigest, uri = '', keyInfo = null) {
    const digest = crypto.createHash('sha1').update(toDigest, 'utf8').digest('base64');
    const signedInfo =
      '<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">' +
      '<CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"></CanonicalizationMethod>' +
      '<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"></SignatureMethod>' +
      `<Reference URI="${uri}">` +
      '<Transforms><Transform Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"></Transform></Transforms>' +
      '<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></DigestMethod>' +
      `<DigestValue>${digest}</DigestValue>` +
      '</Reference>' +
      '</SignedInfo>';
    const signatureValue = this.fiel.signSha1Base64(signedInfo);
    const ki =
      keyInfo ||
      '<KeyInfo><X509Data><X509IssuerSerial>' +
        `<X509IssuerName>${esc(this.fiel.issuerRfc4514)}</X509IssuerName>` +
        `<X509SerialNumber>${this.fiel.serialDecimal}</X509SerialNumber>` +
        '</X509IssuerSerial>' +
        `<X509Certificate>${this.fiel.certificateBase64}</X509Certificate>` +
        '</X509Data></KeyInfo>';
    return (
      '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">' +
      signedInfo.replace('<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">', '<SignedInfo>') +
      `<SignatureValue>${signatureValue}</SignatureValue>` +
      ki +
      '</Signature>'
    );
  }

  async call(url, action, body, withToken = true) {
    const headers = {
      'Content-Type': 'text/xml; charset=utf-8',
      Accept: 'text/xml',
      SOAPAction: action,
    };
    if (withToken) headers.Authorization = `WRAP access_token="${await this.getToken()}"`;
    const res = await this.httpPost(url, headers, body);
    if (res.status >= 400) {
      const fault = soapFault(res.body);
      throw new Error(`El SAT respondió con error (${res.status})${fault ? ': ' + fault : ''}`);
    }
    return res.body;
  }

  // ---------- Autenticacion ----------
  async getToken() {
    if (this.token && Date.now() < this.tokenExpires - 30_000) return this.token;
    const created = new Date();
    const expires = new Date(created.getTime() + 5 * 60_000);
    const c = created.toISOString();
    const e = expires.toISOString();
    const tokenId = `uuid-${crypto.randomUUID()}-1`;

    const toDigest =
      '<u:Timestamp xmlns:u="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd" u:Id="_0">' +
      `<u:Created>${c}</u:Created><u:Expires>${e}</u:Expires></u:Timestamp>`;
    const keyInfo =
      '<KeyInfo><o:SecurityTokenReference>' +
      `<o:Reference URI="#${tokenId}" ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3"></o:Reference>` +
      '</o:SecurityTokenReference></KeyInfo>';
    const sig = this.signature(toDigest, '#_0', keyInfo);

    const body =
      '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:u="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">' +
      '<s:Header><o:Security xmlns:o="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" s:mustUnderstand="1">' +
      `<u:Timestamp u:Id="_0"><u:Created>${c}</u:Created><u:Expires>${e}</u:Expires></u:Timestamp>` +
      `<o:BinarySecurityToken u:Id="${tokenId}" ValueType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3" EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${this.fiel.certificateBase64}</o:BinarySecurityToken>` +
      sig +
      '</o:Security></s:Header>' +
      '<s:Body><Autentica xmlns="http://DescargaMasivaTerceros.gob.mx"></Autentica></s:Body>' +
      '</s:Envelope>';

    const xml = await this.call(URLS.auth, ACTIONS.auth, body, false);
    const token = getText(xml, 'AutenticaResult');
    if (!token) throw new Error('No se pudo iniciar sesión en el SAT con la e.firma. ' + soapFault(xml));
    this.token = token;
    this.tokenExpires = expires.getTime();
    return token;
  }

  // ---------- Solicitud ----------
  // opts: { tipo: 'emitidos'|'recibidos', desde, hasta (Date o 'YYYY-MM-DDTHH:mm:ss'),
  //         tipoSolicitud: 'CFDI'|'Metadata', tipoComprobante: 'I'|'E'|'T'|'N'|'P'|'' , estado: 'Vigente'|'Cancelado'|'' }
  async solicitar(opts) {
    const rfc = this.fiel.rfc;
    const base = {
      FechaInicial: fmtDate(opts.desde),
      FechaFinal: fmtDate(opts.hasta),
      TipoSolicitud: opts.tipoSolicitud || 'CFDI',
      TipoComprobante: opts.tipoComprobante || '',
      EstadoComprobante: opts.estado || '',
      RfcACuentaTerceros: opts.rfcTerceros || '',
    };
    let op, action, a;
    if (opts.tipo === 'emitidos') {
      op = 'SolicitaDescargaEmitidos';
      action = ACTIONS.emitidos;
      a = { ...base, RfcEmisor: rfc };
    } else {
      op = 'SolicitaDescargaRecibidos';
      action = ACTIONS.recibidos;
      a = { ...base, RfcReceptor: rfc, RfcEmisor: opts.rfcContraparte || '' };
    }
    return this._solicitud(op, action, attrs(a), `${op}Result`);
  }

  async solicitarPorFolio(uuid) {
    const a = attrs({ Folio: uuid.toUpperCase(), RfcSolicitante: this.fiel.rfc });
    return this._solicitud('SolicitaDescargaFolio', ACTIONS.folio, a, 'SolicitaDescargaFolioResult');
  }

  async _solicitud(op, action, attrText, resultEl) {
    const toDigest = `<des:${op} xmlns:des="${NS_DES}"><des:solicitud ${attrText}></des:solicitud></des:${op}>`;
    const sig = this.signature(toDigest);
    const body =
      `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:des="${NS_DES}" xmlns:xd="http://www.w3.org/2000/09/xmldsig#">` +
      `<s:Header/><s:Body><des:${op}><des:solicitud ${attrText}>${sig}</des:solicitud></des:${op}></s:Body></s:Envelope>`;
    const xml = await this.call(URLS.solicita, action, body);
    return {
      idSolicitud: getAttr(xml, resultEl, 'IdSolicitud'),
      codigo: getAttr(xml, resultEl, 'CodEstatus'),
      mensaje: getAttr(xml, resultEl, 'Mensaje'),
    };
  }

  // ---------- Verificacion ----------
  async verificar(idSolicitud) {
    const a = attrs({ IdSolicitud: idSolicitud, RfcSolicitante: this.fiel.rfc });
    const toDigest = `<des:VerificaSolicitudDescarga xmlns:des="${NS_DES}"><des:solicitud ${a}></des:solicitud></des:VerificaSolicitudDescarga>`;
    const sig = this.signature(toDigest);
    const body =
      `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:des="${NS_DES}" xmlns:xd="http://www.w3.org/2000/09/xmldsig#">` +
      `<s:Header/><s:Body><des:VerificaSolicitudDescarga><des:solicitud ${a}>${sig}</des:solicitud></des:VerificaSolicitudDescarga></s:Body></s:Envelope>`;
    const xml = await this.call(URLS.verifica, ACTIONS.verifica, body);
    const r = 'VerificaSolicitudDescargaResult';
    const estado = Number(getAttr(xml, r, 'EstadoSolicitud')) || 0;
    return {
      codigo: getAttr(xml, r, 'CodEstatus'),
      mensaje: getAttr(xml, r, 'Mensaje'),
      estado,
      estadoTexto: ESTADOS_SOLICITUD[estado] || 'Desconocido',
      codigoEstado: getAttr(xml, r, 'CodigoEstadoSolicitud'),
      numeroCfdis: Number(getAttr(xml, r, 'NumeroCFDIs')) || 0,
      paquetes: getAllText(xml, 'IdsPaquetes').filter(Boolean),
    };
  }

  // ---------- Descarga ----------
  async descargar(idPaquete) {
    const a = attrs({ IdPaquete: idPaquete, RfcSolicitante: this.fiel.rfc });
    const toDigest = `<des:PeticionDescargaMasivaTercerosEntrada xmlns:des="${NS_DES}"><des:peticionDescarga ${a}></des:peticionDescarga></des:PeticionDescargaMasivaTercerosEntrada>`;
    const sig = this.signature(toDigest);
    const body =
      `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:des="${NS_DES}" xmlns:xd="http://www.w3.org/2000/09/xmldsig#">` +
      `<s:Header/><s:Body><des:PeticionDescargaMasivaTercerosEntrada><des:peticionDescarga ${a}>${sig}</des:peticionDescarga></des:PeticionDescargaMasivaTercerosEntrada></s:Body></s:Envelope>`;
    const xml = await this.call(URLS.descarga, ACTIONS.descarga, body);
    const paquete = getText(xml, 'Paquete');
    return {
      codigo: getAttr(xml, 'respuesta', 'CodEstatus'),
      mensaje: getAttr(xml, 'respuesta', 'Mensaje'),
      zip: paquete ? Buffer.from(paquete.replace(/\s+/g, ''), 'base64') : null,
    };
  }
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function fmtDate(d) {
  if (typeof d === 'string') return d;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function defaultHttpPost(url, headers, body) {
  let fetchFn = globalThis.fetch;
  try {
    const { net } = require('electron');
    if (net && net.fetch) fetchFn = net.fetch.bind(net);
  } catch (_) {}

  let lastError;
  for (let intento = 1; intento <= 4; intento++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 180_000);
    try {
      const res = await fetchFn(url, { method: 'POST', headers, body, signal: ctrl.signal });
      const text = await res.text();
      if (res.status >= 500 && !/faultstring/i.test(text) && intento < 4) {
        lastError = new Error(`El SAT no respondió (${res.status}).`);
      } else {
        return { status: res.status, body: text };
      }
    } catch (err) {
      lastError = new Error('No hay conexión con el SAT: ' + (err.name === 'AbortError' ? 'tiempo agotado' : err.message));
    } finally {
      clearTimeout(timer);
    }
    await new Promise((r) => setTimeout(r, 2000 * intento));
  }
  throw lastError;
}

module.exports = { SatWebService, fmtDate, ESTADOS_SOLICITUD };
