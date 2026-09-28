const { contextBridge, ipcRenderer } = require('electron');

const CANALES = [
  'app:init', 'licencia:activar', 'licencia:salir',
  'dueno:crearLlaves', 'dueno:activar', 'dueno:generarCodigo', 'dueno:codigos',
  'contrib:guardar', 'contrib:eliminar', 'contrib:copiarCiec',
  'dialog:archivo', 'dialog:carpeta', 'ajustes:guardar',
  'descarga:iniciar', 'descarga:cancelar',
  'facturas:listar', 'facturas:excel', 'facturas:pdf', 'facturas:importar',
  'abrir:ruta', 'abrir:carpetaRfc', 'abrir:externo', 'portapapeles',
];

contextBridge.exposeInMainWorld('api', {
  call: async (canal, ...args) => {
    if (!CANALES.includes(canal)) throw new Error('Canal no permitido');
    const r = await ipcRenderer.invoke(canal, ...args);
    if (!r.ok) throw new Error(r.error);
    return r.data;
  },
  instalarActualizacion: () => ipcRenderer.invoke('update:instalar'),
  on: (canal, fn) => {
    if (!['descarga:evento', 'update'].includes(canal)) return;
    ipcRenderer.on(canal, (_e, data) => fn(data));
  },
});
