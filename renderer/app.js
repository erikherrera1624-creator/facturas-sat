/* global window, document */
const $ = (id) => document.getElementById(id);
const api = window.api;

const state = {
  init: null,
  contribId: null,
  columnas: [],
  seleccion: new Set(),
  cerPath: null,
  keyPath: null,
  editId: null,
  ultimoResultado: null,
  ultimasFilas: [],
};

const TITULOS = {
  descargar: 'Descargar facturas',
  facturas: 'Mis facturas',
  excel: 'Columnas del Excel',
  contribuyentes: 'Contribuyentes',
  cuenta: 'Mi cuenta',
  dueno: 'Panel del dueño',
  'activar-dueno': 'Modo dueño',
};
const TIPO_TXT = { I: 'Ingreso', E: 'Nota de crédito', P: 'Pago', N: 'Nómina', T: 'Traslado' };

const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function toast(msg, error = false, ms = 4500) {
  const t = $('toast');
  t.innerHTML = msg;
  t.className = 'toast' + (error ? ' error' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('oculto'), ms);
}

async function call(canal, ...args) {
  try {
    return await api.call(canal, ...args);
  } catch (e) {
    toast(h(e.message), true, 7000);
    throw e;
  }
}

// ---------- Navegacion ----------
function ir(vista) {
  document.querySelectorAll('.contenido > section').forEach((s) => s.classList.add('oculto'));
  $('v-' + vista).classList.remove('oculto');
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('activo', b.dataset.vista === vista));
  $('titulo').textContent = TITULOS[vista] || '';
  if (vista === 'facturas') cargarFacturas();
  if (vista === 'dueno') cargarCodigos();
}
document.querySelectorAll('#nav button').forEach((b) => b.addEventListener('click', () => ir(b.dataset.vista)));

// ---------- Chips ----------
function chips(id, multiple = true) {
  const box = $(id);
  box.addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    if (!multiple) box.querySelectorAll('.chip').forEach((x) => x !== c && x.classList.remove('on'));
    c.classList.toggle('on');
  });
  return () => [...box.querySelectorAll('.chip.on')].map((c) => c.dataset.v);
}
const getTipos = chips('ch-tipo');
const getTC = chips('ch-tc');
const getMP = chips('ch-mp');

function ponerPeriodo(p) {
  const hoy = new Date();
  let d, a;
  if (p === 'mes') { d = new Date(hoy.getFullYear(), hoy.getMonth(), 1); a = hoy; }
  if (p === 'mesPasado') { d = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1); a = new Date(hoy.getFullYear(), hoy.getMonth(), 0); }
  if (p === 'anio') { d = new Date(hoy.getFullYear(), 0, 1); a = hoy; }
  if (p === 'anioPasado') { d = new Date(hoy.getFullYear() - 1, 0, 1); a = new Date(hoy.getFullYear() - 1, 11, 31); }
  $('f-desde').value = ymd(d);
  $('f-hasta').value = ymd(a);
}
$('ch-periodo').addEventListener('click', (e) => {
  const c = e.target.closest('.chip');
  if (!c) return;
  $('ch-periodo').querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === c));
  ponerPeriodo(c.dataset.p);
});
['f-desde', 'f-hasta'].forEach((id) => $(id).addEventListener('change', () => $('ch-periodo').querySelectorAll('.chip').forEach((x) => x.classList.remove('on'))));

// ---------- Inicio ----------
async function iniciar() {
  const init = await call('app:init');
  state.init = init;
  state.columnas = init.ajustes.columnas || init.presets.contable;
  $('version').textContent = 'v' + init.version;
  $('cu-version').textContent = init.version;
  $('cu-link').textContent = init.linkDescarga || '(disponible al publicar la app en GitHub)';
  $('cu-carpeta').textContent = init.ajustes.carpetaDescargas;
  $('f-pdf').checked = init.ajustes.generarPdf !== false;
  $('x-conceptos').checked = !!init.ajustes.hojaConceptos;
  $('x-pagos').checked = init.ajustes.hojaPagos !== false;
  const r = init.remote || {};
  $('gate-precio').textContent = r.precioTexto ? '· ' + r.precioTexto : '';
  if (r.aviso) { $('aviso').textContent = r.aviso; $('aviso').classList.remove('oculto'); }
  $('cu-soporte').textContent = init.contactoSoporte || '';
  ponerPeriodo('anio');
  pintarContribuyentes(init.contribuyentes);
  pintarColumnas();
  aplicarLicencia(init.licencia);
}

function aplicarLicencia(lic) {
  state.init.licencia = lic;
  $('gate').classList.toggle('oculto', !!lic.acceso);
  if (!lic.acceso) $('gate-msg').textContent = lic.mensaje || 'Activa tu cuenta para comenzar.';
  $('plan-pill').textContent = { dueno: 'Dueño', pago: 'Suscripción Pro', codigo: lic.plan === 'basico' ? 'Código · Básico' : 'Código · Pro', prueba: 'Prueba gratis' }[lic.rol] || 'Sin licencia';
  $('cu-estado').textContent = lic.mensaje || '';
  $('nav-dueno').classList.toggle('oculto', lic.rol !== 'dueno');
  iniciarAnuncios(lic);
}

// ---------- Licencia ----------
$('gate-activar').addEventListener('click', async () => {
  const lic = await call('licencia:activar', $('gate-clave').value);
  aplicarLicencia(lic);
  if (lic.acceso) toast('¡Bienvenido! Tu cuenta está activa.');
});
$('gate-clave').addEventListener('keydown', (e) => e.key === 'Enter' && $('gate-activar').click());
const comprar = () => {
  const link = state.init.remote && state.init.remote.linkDeCompra;
  if (link) call('abrir:externo', link);
  else toast('El dueño aún no configura el enlace de pago.', true);
};
$('gate-comprar').addEventListener('click', comprar);
$('cu-comprar').addEventListener('click', comprar);
$('cu-cambiar').addEventListener('click', async () => {
  aplicarLicencia(await call('licencia:salir'));
  $('gate').classList.remove('oculto');
});
const abrirModoDueno = () => {
  $('gate').classList.add('oculto');
  ir('activar-dueno');
};
$('gate-dueno').addEventListener('click', abrirModoDueno);
$('cu-dueno').addEventListener('click', abrirModoDueno);

$('ad-activar').addEventListener('click', async () => {
  const r = await call('dueno:activar');
  if (!r.ok) {
    $('ad-resultado').classList.remove('oculto');
    $('ad-archivo').textContent = '(tu archivo .pem)';
    $('ad-publica').textContent = r.publicaBase64;
    toast(r.mensaje, true, 9000);
    return;
  }
  aplicarLicencia(r.licencia);
  toast('Modo dueño activado.');
  ir('dueno');
});
$('ad-crear').addEventListener('click', async () => {
  if (!confirm('Esto crea una llave NUEVA. Si ya tienes una, usa "Tengo mi llave". ¿Continuar?')) return;
  const r = await call('dueno:crearLlaves');
  $('ad-resultado').classList.remove('oculto');
  $('ad-archivo').textContent = r.archivo;
  $('ad-publica').textContent = r.publicaBase64;
});
$('ad-copiar').addEventListener('click', async () => {
  await call('portapapeles', $('ad-publica').textContent);
  toast('Llave pública copiada.');
});

// ---------- Dueño ----------
$('d-vence').value = ymd(new Date(Date.now() + 30 * 86400000));
$('d-generar').addEventListener('click', async () => {
  const codigo = await call('dueno:generarCodigo', { nombre: $('d-nombre').value, vence: $('d-vence').value, plan: $('d-plan').value });
  $('d-codigo').textContent = codigo;
  $('d-codigo').classList.remove('oculto');
  await call('portapapeles', codigo);
  toast('Código creado y copiado. Envíaselo a tu cliente.');
  cargarCodigos();
});
async function cargarCodigos() {
  const lista = await call('dueno:codigos');
  $('d-lista').innerHTML = lista
    .map((c, i) => `<tr><td class="uuid">${h(c.i)}</td><td>${h(c.n)}</td><td>${h(c.v || 'Nunca')}</td><td>${c.p === 'b' ? 'Básico' : 'Pro'}</td><td><button class="iconbtn" data-i="${i}">Copiar</button></td></tr>`)
    .join('') || '<tr><td colspan="5" class="muted">Aún no creas códigos.</td></tr>';
  $('d-lista').onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    await call('portapapeles', lista[b.dataset.i].codigo);
    toast('Código copiado.');
  };
}

// ---------- Anuncios ----------
function iniciarAnuncios(lic) {
  clearInterval(iniciarAnuncios._t);
  const cfg = (state.init.remote && state.init.remote.anuncios) || {};
  const lista = (cfg.lista || []).filter((a) => a.texto || a.imagen);
  const mostrar = lic.acceso && lic.rol !== 'dueno' && (lic.plan === 'basico' || cfg.mostrarAUsuariosDePago);
  $('anuncio').classList.toggle('oculto', !mostrar || !lista.length);
  if (!mostrar || !lista.length) return;
  let i = 0;
  const pintar = () => {
    const a = lista[i++ % lista.length];
    $('an-texto').textContent = a.texto || '';
    $('an-img').classList.toggle('oculto', !a.imagen);
    if (a.imagen) $('an-img').src = a.imagen;
    $('anuncio').onclick = () => a.link && call('abrir:externo', a.link);
  };
  pintar();
  iniciarAnuncios._t = setInterval(pintar, (cfg.segundosEntreAnuncios || 30) * 1000);
}

// ---------- Contribuyentes ----------
function pintarContribuyentes(lista) {
  state.init.contribuyentes = lista;
  const sel = $('sel-contrib');
  const prev = state.contribId;
  sel.innerHTML = lista.length
    ? lista.map((c) => `<option value="${c.id}">${h(c.rfc)}${c.nombre ? ' · ' + h(c.nombre) : ''}</option>`).join('')
    : '<option value="">Agrega un RFC primero</option>';
  state.contribId = lista.find((c) => c.id === prev) ? prev : lista[0] ? lista[0].id : null;
  if (state.contribId) sel.value = state.contribId;

  $('c-lista').innerHTML = lista.length
    ? lista
        .map((c) => {
          const f = c.fiel;
          const fielTxt = !c.tieneFiel
            ? '<span class="no-txt">Sin e.firma</span>'
            : f && !f.vigente
            ? '<span class="no-txt">e.firma vencida</span>'
            : `<span class="ok-txt">e.firma vigente${f ? ' hasta ' + f.vigenciaFin.slice(0, 10) : ''}</span>`;
          return `<div class="contrib">
            <div class="avatar">${h(c.rfc.slice(0, 2))}</div>
            <div class="info"><b>${h(c.rfc)}</b><div class="small muted">${h(c.nombre || '')}</div>${fielTxt} ${c.tieneCiec ? '· <span class="ok-txt">CIEC</span>' : ''}</div>
            <div class="fila">
              ${c.tieneCiec ? `<button class="btn chico" data-accion="ciec" data-id="${c.id}">Copiar CIEC</button>` : ''}
              <button class="btn chico" data-accion="portal" data-id="${c.id}">Portal SAT</button>
              <button class="btn chico" data-accion="editar" data-id="${c.id}">Editar</button>
              <button class="btn chico peligro" data-accion="borrar" data-id="${c.id}">Borrar</button>
            </div></div>`;
        })
        .join('')
    : '<div class="vacio"><b>Aún no tienes RFC</b>Agrega uno con su e.firma para empezar a descargar.</div>';
}

$('sel-contrib').addEventListener('change', (e) => {
  state.contribId = e.target.value;
  state.seleccion.clear();
  if (!$('v-facturas').classList.contains('oculto')) cargarFacturas();
});

$('c-lista').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const id = b.dataset.id;
  const c = state.init.contribuyentes.find((x) => x.id === id);
  if (b.dataset.accion === 'ciec') {
    await call('contrib:copiarCiec', id);
    toast('CIEC copiada (se borra del portapapeles en 1 minuto).');
  } else if (b.dataset.accion === 'portal') {
    call('abrir:externo', 'https://portalcfdi.facturaelectronica.sat.gob.mx/');
  } else if (b.dataset.accion === 'editar') {
    limpiarForm();
    state.editId = id;
    $('c-form-titulo').textContent = 'Editar ' + c.rfc;
    $('c-rfc').value = c.rfc;
    $('c-nombre').value = c.nombre || '';
    $('c-ciec').placeholder = c.tieneCiec ? 'Guardada · escribe para cambiarla' : '••••••••';
    $('c-pass').placeholder = c.tieneFiel ? 'Guardada · escribe para cambiarla' : '••••••••';
    if (c.tieneFiel) {
      $('c-cer').querySelector('span').textContent = 'Guardado · clic para cambiar';
      $('c-key').querySelector('span').textContent = 'Guardado · clic para cambiar';
    }
  } else if (b.dataset.accion === 'borrar') {
    if (!confirm(`¿Borrar ${c.rfc} y sus datos guardados? (Tus archivos descargados no se borran.)`)) return;
    pintarContribuyentes(await call('contrib:eliminar', id));
  }
});

function limpiarForm() {
  state.editId = null;
  state.cerPath = state.keyPath = null;
  ['c-rfc', 'c-nombre', 'c-ciec', 'c-pass'].forEach((id) => ($(id).value = ''));
  $('c-ciec').placeholder = $('c-pass').placeholder = '••••••••';
  $('c-form-titulo').textContent = 'Agregar contribuyente';
  $('c-cer').className = 'archivo';
  $('c-key').className = 'archivo';
  $('c-cer').querySelector('span').textContent = 'Elegir certificado…';
  $('c-key').querySelector('span').textContent = 'Elegir llave privada…';
}
$('c-nuevo').addEventListener('click', limpiarForm);
$('c-cancelar').addEventListener('click', limpiarForm);
for (const tipo of ['cer', 'key']) {
  $('c-' + tipo).addEventListener('click', async () => {
    const p = await call('dialog:archivo', tipo);
    if (!p) return;
    state[tipo + 'Path'] = p;
    $('c-' + tipo).classList.add('listo');
    $('c-' + tipo).querySelector('span').textContent = p.split(/[\\/]/).pop();
  });
}
$('c-guardar').addEventListener('click', async () => {
  const btn = $('c-guardar');
  btn.disabled = true;
  try {
    const lista = await call('contrib:guardar', {
      id: state.editId,
      rfc: $('c-rfc').value,
      nombre: $('c-nombre').value,
      ciec: $('c-ciec').value,
      cerPath: state.cerPath,
      keyPath: state.keyPath,
      fielPassword: $('c-pass').value,
    });
    pintarContribuyentes(lista);
    const rfc = $('c-rfc').value.trim().toUpperCase();
    const c = lista.find((x) => x.rfc === rfc);
    if (c) { state.contribId = c.id; $('sel-contrib').value = c.id; }
    limpiarForm();
    toast('Guardado correctamente. ✓');
  } finally {
    btn.disabled = false;
  }
});

// ---------- Descargar ----------
let trabajosTotal = 0;
$('btn-descargar').addEventListener('click', async () => {
  if (!state.contribId) {
    toast('Primero agrega tu RFC y e.firma en "Contribuyentes".', true);
    return ir('contribuyentes');
  }
  const uuids = $('f-uuids').value.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  const bad = uuids.filter((u) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(u));
  if (bad.length) return toast('Folio fiscal no válido: ' + h(bad[0]), true);
  const tipos = getTipos();
  if (!tipos.length) return toast('Elige Emitidas, Recibidas o ambas.', true);
  if (!uuids.length && (!$('f-desde').value || !$('f-hasta').value)) return toast('Elige el periodo.', true);
  if ($('f-desde').value > $('f-hasta').value) return toast('La fecha "Desde" es posterior a "Hasta".', true);

  const opciones = {
    contribuyenteId: state.contribId,
    tipos,
    desde: $('f-desde').value,
    hasta: $('f-hasta').value,
    tiposComprobante: getTC(),
    metodosPago: getMP(),
    uuids,
    generarPdf: $('f-pdf').checked,
    generarExcel: $('f-excel').checked,
    soloVigentes: $('f-vigentes').checked,
    columnas: state.columnas,
    hojaConceptos: $('x-conceptos').checked,
    hojaPagos: $('x-pagos').checked,
  };
  call('ajustes:guardar', { generarPdf: opciones.generarPdf });

  $('form-descarga').classList.add('oculto');
  $('resultado').classList.add('oculto');
  $('progreso').classList.remove('oculto');
  $('prog-spin').classList.remove('oculto');
  $('prog-titulo').textContent = 'Descargando…';
  $('prog-trabajos').innerHTML = '';
  $('prog-barra').style.width = '3%';
  $('prog-contador').textContent = '';
  try {
    const r = await api.call('descarga:iniciar', opciones);
    state.ultimoResultado = r;
    mostrarResultado(r);
  } catch (e) {
    $('progreso').classList.add('oculto');
    $('form-descarga').classList.remove('oculto');
    toast(h(e.message), true, 9000);
  }
});
$('btn-cancelar').addEventListener('click', () => {
  api.call('descarga:cancelar');
  $('prog-log').textContent = 'Cancelando…';
});

api.on('descarga:evento', (ev) => {
  if (ev.tipo === 'log') $('prog-log').textContent = ev.mensaje;
  if (ev.tipo === 'estado') {
    const hojas = ev.trabajos.filter((t) => !t.estado.startsWith('Dividido'));
    trabajosTotal = hojas.length;
    const fin = hojas.filter((t) => /^(Listo|Sin facturas|Ya descargado|Error)/.test(t.estado)).length;
    $('prog-barra').style.width = Math.max(3, Math.round((fin / Math.max(1, trabajosTotal)) * 90)) + '%';
    $('prog-contador').textContent = `${fin} de ${trabajosTotal} periodos · ${ev.nuevas} facturas nuevas`;
    $('prog-trabajos').innerHTML = ev.trabajos
      .map((t) => {
        const cls = /^(Listo|Sin facturas|Ya descargado)/.test(t.estado) ? 'ok' : t.estado.startsWith('Error') ? 'err' : '';
        return `<div class="trabajo" title="${h(t.estado)}"><b>${h(t.etiqueta)}</b><span class="estado ${cls}">${h(t.estado.length > 28 ? t.estado.slice(0, 28) + '…' : t.estado)}${t.cfdis ? ' · ' + t.cfdis : ''}</span></div>`;
      })
      .join('');
  }
  if (ev.tipo === 'progreso') {
    $('prog-log').textContent = `${ev.fase === 'PDF' ? 'Creando PDF' : ev.fase === 'Detalle' ? 'Armando hojas de detalle' : 'Creando Excel'}: ${ev.hechas} de ${ev.total}`;
    $('prog-barra').style.width = 90 + Math.round((ev.hechas / Math.max(1, ev.total)) * 10) + '%';
  }
});

function mostrarResultado(r) {
  $('progreso').classList.add('oculto');
  $('resultado').classList.remove('oculto');
  $('res-titulo').textContent = r.total ? `¡Listo! ${r.total.toLocaleString('es-MX')} facturas` : 'No se encontraron facturas';
  let txt = `${r.nuevas.toLocaleString('es-MX')} nuevas descargadas del SAT. Guardadas en: ${h(r.carpeta)}`;
  if (r.errores.length) txt += `<br><span class="no-txt">Algunos periodos tuvieron problemas:</span><br>${r.errores.map(h).join('<br>')}<br><span class="small">Vuelve a presionar "Descargar" más tarde para reintentarlos; lo ya descargado no se repite.</span>`;
  $('res-texto').innerHTML = txt;
  $('res-excel').classList.toggle('oculto', !r.excel);
}
$('res-excel').addEventListener('click', () => state.ultimoResultado && call('abrir:ruta', state.ultimoResultado.excel));
$('res-carpeta').addEventListener('click', () => call('abrir:carpetaRfc', state.contribId));
$('res-ver').addEventListener('click', () => {
  $('b-desde').value = $('f-desde').value;
  $('b-hasta').value = $('f-hasta').value;
  ir('facturas');
});
$('res-nueva').addEventListener('click', () => {
  $('resultado').classList.add('oculto');
  $('form-descarga').classList.remove('oculto');
});

// ---------- Mis facturas ----------
function filtrosBiblioteca() {
  return {
    texto: $('b-texto').value,
    tipos: $('b-tipo').value ? [$('b-tipo').value] : [],
    tiposComprobante: $('b-tc').value ? [$('b-tc').value] : [],
    metodosPago: $('b-mp').value ? [$('b-mp').value] : [],
    desde: $('b-desde').value,
    hasta: $('b-hasta').value,
    columnas: state.columnas,
    hojaConceptos: $('x-conceptos').checked,
    hojaPagos: $('x-pagos').checked,
  };
}

let tBuscar;
['b-texto', 'b-tipo', 'b-tc', 'b-mp', 'b-desde', 'b-hasta'].forEach((id) =>
  $(id).addEventListener('input', () => {
    clearTimeout(tBuscar);
    tBuscar = setTimeout(cargarFacturas, 250);
  })
);

async function cargarFacturas() {
  if (!state.contribId) {
    $('b-filas').innerHTML = '<tr><td colspan="11"><div class="vacio"><b>Agrega un RFC</b>Ve a "Contribuyentes".</div></td></tr>';
    return;
  }
  const r = await call('facturas:listar', { contribuyenteId: state.contribId, filtros: filtrosBiblioteca(), limite: 1000 });
  state.ultimasFilas = r.filas;
  $('k-n').textContent = r.total.toLocaleString('es-MX');
  $('k-total').textContent = money(r.sumaTotal);
  $('k-iva').textContent = money(r.sumaIva);
  $('b-limite').textContent = r.total > r.filas.length ? `Mostrando las ${r.filas.length} más recientes de ${r.total}. El Excel incluye todas.` : '';
  $('b-filas').innerHTML = r.filas.length
    ? r.filas
        .map(
          (f) => `<tr>
      <td><input type="checkbox" data-u="${f.uuid}" ${state.seleccion.has(f.uuid) ? 'checked' : ''}></td>
      <td>${h((f.fecha || '').slice(0, 10))}</td>
      <td class="small muted">${f.tipo === 'Emitida' ? '↗ Emitida' : '↙ Recibida'}</td>
      <td><span class="tag ${h(f.tipoComprobante)}">${h(TIPO_TXT[f.tipoComprobante] || f.tipoComprobante)}</span></td>
      <td>${h(f.metodoPago)}</td>
      <td>${h([f.serie, f.folio].filter(Boolean).join('-'))}</td>
      <td title="${h(f.rfcEmisor)}">${h((f.nombreEmisor || f.rfcEmisor).slice(0, 28))}</td>
      <td title="${h(f.rfcReceptor)}">${h((f.nombreReceptor || f.rfcReceptor).slice(0, 28))}</td>
      <td class="n">${money(f.total)}${f.moneda && f.moneda !== 'MXN' ? ' ' + h(f.moneda) : ''}</td>
      <td class="uuid">${h(f.uuid)}</td>
      <td><button class="iconbtn" data-pdf="${f.uuid}">PDF</button><button class="iconbtn" data-xml="${h(f.archivoXml)}">XML</button></td>
    </tr>`
        )
        .join('')
    : '<tr><td colspan="11"><div class="vacio"><b>No hay facturas</b>Descárgalas en "Descargar" o usa "Importar XML".</div></td></tr>';
}

$('b-filas').addEventListener('click', async (e) => {
  const t = e.target;
  if (t.dataset.u) {
    t.checked ? state.seleccion.add(t.dataset.u) : state.seleccion.delete(t.dataset.u);
  } else if (t.dataset.pdf) {
    await call('facturas:pdf', { contribuyenteId: state.contribId, uuids: [t.dataset.pdf] });
  } else if (t.dataset.xml) {
    call('abrir:ruta', t.dataset.xml);
  }
});
$('b-todas').addEventListener('change', (e) => {
  state.ultimasFilas.forEach((f) => (e.target.checked ? state.seleccion.add(f.uuid) : state.seleccion.delete(f.uuid)));
  cargarFacturas();
});
$('b-excel').addEventListener('click', async () => {
  toast('Creando Excel…');
  await call('facturas:excel', { contribuyenteId: state.contribId, filtros: filtrosBiblioteca() });
  toast('Excel creado. ✓');
});
$('b-excel-sel').addEventListener('click', async () => {
  if (!state.seleccion.size) return toast('Marca primero las facturas.', true);
  await call('facturas:excel', { contribuyenteId: state.contribId, filtros: filtrosBiblioteca(), uuids: [...state.seleccion] });
  toast('Excel creado. ✓');
});
$('b-pdf-sel').addEventListener('click', async () => {
  if (!state.seleccion.size) return toast('Marca primero las facturas.', true);
  toast('Creando PDF…');
  const n = await call('facturas:pdf', { contribuyenteId: state.contribId, uuids: [...state.seleccion] });
  toast(`${n} PDF listos. Están junto a cada XML.`);
  cargarFacturas();
});
$('b-importar').addEventListener('click', async () => {
  if (!state.contribId) return toast('Agrega un RFC primero.', true);
  const n = await call('facturas:importar', state.contribId);
  if (n) toast(`${n} facturas importadas.`);
  cargarFacturas();
});

// ---------- Columnas Excel ----------
function pintarColumnas() {
  const cols = state.init.columnas;
  const grupos = [...new Set(cols.map((c) => c.grupo))];
  const sel = new Set(state.columnas);
  $('cols-contenedor').innerHTML = grupos
    .map(
      (g) => `<div class="grupo-cols"><h3>${h(g)}</h3><div class="cols">${cols
        .filter((c) => c.grupo === g)
        .map((c) => `<label class="check"><input type="checkbox" data-k="${c.key}" ${sel.has(c.key) ? 'checked' : ''}> ${h(c.label)}</label>`)
        .join('')}</div></div>`
    )
    .join('');
}
$('cols-contenedor').addEventListener('change', () => {
  const orden = state.init.columnas.map((c) => c.key);
  const marcadas = new Set([...document.querySelectorAll('#cols-contenedor input:checked')].map((i) => i.dataset.k));
  state.columnas = orden.filter((k) => marcadas.has(k));
});
document.querySelectorAll('[data-preset]').forEach((b) =>
  b.addEventListener('click', () => {
    state.columnas = b.dataset.preset === 'ninguno' ? [] : [...state.init.presets[b.dataset.preset]];
    pintarColumnas();
  })
);
$('x-guardar').addEventListener('click', async () => {
  if (!state.columnas.length) return toast('Elige al menos una columna.', true);
  await call('ajustes:guardar', { columnas: state.columnas, hojaConceptos: $('x-conceptos').checked, hojaPagos: $('x-pagos').checked });
  toast('Columnas guardadas. ✓');
});

// ---------- Cuenta ----------
$('cu-copiar').addEventListener('click', async () => {
  if (!state.init.linkDescarga) return toast('El enlace existe cuando publicas la app en GitHub.', true);
  await call('portapapeles', state.init.linkDescarga);
  toast('Enlace copiado.');
});
$('cu-cambiar-carpeta').addEventListener('click', async () => {
  const p = await call('dialog:carpeta');
  if (!p) return;
  const a = await call('ajustes:guardar', { carpetaDescargas: p });
  $('cu-carpeta').textContent = a.carpetaDescargas;
  toast('Carpeta actualizada.');
});

// ---------- Actualizaciones ----------
api.on('update', (u) => {
  if (u.estado === 'descargando') toast(`Descargando actualización ${h(u.version)}…`);
  if (u.estado === 'lista') {
    $('toast').innerHTML = `Nueva versión ${h(u.version)} lista. <button class="btn oro chico" id="btn-update">Reiniciar y actualizar</button>`;
    $('toast').className = 'toast';
    $('btn-update').onclick = () => api.instalarActualizacion();
  }
});

iniciar();
