// Lectura de la e.firma (FIEL): archivo .cer, archivo .key y su contraseña.
const crypto = require('crypto');
const forge = require('node-forge');

function derToPem(der, label) {
  const b64 = Buffer.from(der).toString('base64').match(/.{1,64}/g).join('\n');
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`;
}

function loadPrivateKey(keyDer, password) {
  try {
    return crypto.createPrivateKey({ key: Buffer.from(keyDer), format: 'der', type: 'pkcs8', passphrase: password });
  } catch (_) {
    // Algunas llaves antiguas usan cifrados que OpenSSL ya no acepta; node-forge si los lee.
    const forgeKey = forge.pki.decryptRsaPrivateKey(derToPem(keyDer, 'ENCRYPTED PRIVATE KEY'), password);
    if (!forgeKey) throw new Error('La contraseña de la e.firma es incorrecta o el archivo .key no es válido.');
    return crypto.createPrivateKey(forge.pki.privateKeyToPem(forgeKey));
  }
}

function parseSubjectField(text, names) {
  for (const line of String(text).split('\n')) {
    const idx = line.indexOf('=');
    if (idx < 0) continue;
    if (names.includes(line.slice(0, idx).trim())) return line.slice(idx + 1).trim();
  }
  return '';
}

class Fiel {
  constructor(cerDer, keyDer, password) {
    this.cerDer = Buffer.from(cerDer);
    let cert;
    try {
      cert = new crypto.X509Certificate(this.cerDer);
    } catch (_) {
      throw new Error('El archivo .cer no es un certificado válido.');
    }
    this.cert = cert;
    this.privateKey = loadPrivateKey(keyDer, password);

    if (!cert.checkPrivateKey(this.privateKey)) {
      throw new Error('El archivo .key no corresponde al archivo .cer.');
    }

    const uid = parseSubjectField(cert.subject, ['x500UniqueIdentifier', '2.5.4.45', 'UID']);
    this.rfc = uid.split('/')[0].trim().toUpperCase();
    this.nombre = parseSubjectField(cert.subject, ['CN', 'name', 'O']);
    this.validFrom = new Date(cert.validFrom);
    this.validTo = new Date(cert.validTo);
    // Los certificados de sello (CSD) traen "OU" (sucursal); la e.firma no.
    this.esCSD = !!parseSubjectField(cert.subject, ['OU']);
  }

  get certificateBase64() {
    return this.cerDer.toString('base64');
  }

  get serialDecimal() {
    return BigInt('0x' + this.cert.serialNumber).toString(10);
  }

  get issuerRfc4514() {
    return this.cert.issuer
      .split('\n')
      .filter(Boolean)
      .reverse()
      .map((p) => p.replace(/,/g, '\\,'))
      .join(',');
  }

  isValidNow() {
    const now = new Date();
    return now >= this.validFrom && now <= this.validTo;
  }

  signSha1Base64(text) {
    return crypto.sign('RSA-SHA1', Buffer.from(text, 'utf8'), this.privateKey).toString('base64');
  }

  info() {
    return {
      rfc: this.rfc,
      nombre: this.nombre,
      vigenciaInicio: this.validFrom.toISOString(),
      vigenciaFin: this.validTo.toISOString(),
      vigente: this.isValidNow(),
      esCSD: this.esCSD,
    };
  }
}

module.exports = { Fiel };
