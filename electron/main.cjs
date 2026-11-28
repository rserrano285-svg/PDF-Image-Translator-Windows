/* Proceso principal del escritorio (Electron). Carga el servidor de desarrollo
   de CRA si está corriendo (localhost:3000), si no, carga el build de producción. */
const http = require('http');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');

const DEV_SERVER_URL = 'http://localhost:3000';

function isDevServerRunning() {
  return new Promise((resolve) => {
    const req = http.get(DEV_SERVER_URL, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function resolveStartUrl() {
  const candidates = [
    path.join(app.getAppPath(), 'build', 'index.html'),
    path.join(__dirname, '..', 'build', 'index.html'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(__dirname, '..', 'build', 'index.html');
}

function safeStartUrl(requested) {
  if (!requested) return null;
  // Solo se permite el servidor de desarrollo local; cualquier otra URL
  // externa se ignora para no cargar código remoto con privilegios.
  if (requested === DEV_SERVER_URL || requested === DEV_SERVER_URL + '/') return DEV_SERVER_URL;
  try {
    const parsed = new URL(requested);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return null;
  } catch {
    // No es una URL absoluta: puede ser una ruta de archivo local.
  }
  return fs.existsSync(requested) || requested.endsWith('.html') ? requested : null;
}

let mainWindow = null;

// Guardar siempre en Descargas por defecto, sin dejar archivos regados.
ipcMain.handle('save-translated-file', async (event, payload) => {
  const { name, bytes, filters } = payload || {};
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Guardar archivo traducido',
    defaultPath: path.join(app.getPath('downloads'), name || 'archivo-traducido'),
    filters: filters || [{ name: 'Todos los archivos', extensions: ['*'] }],
  });
  if (canceled || !filePath) return { canceled: true };
  await fs.promises.writeFile(filePath, Buffer.from(bytes || []));
  return { canceled: false, filePath };
});

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // Los enlaces externos se abren en el navegador del sistema, nunca dentro
  // del renderer (evita que un sitio externo herede la ventana de la app).
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith('http:') || target.startsWith('https:')) {
      shell.openExternal(target).catch(() => {});
    }
    return { action: 'deny' };
  });

  try {
    const iconPath = path.join(__dirname, '..', 'build', 'icon.ico');
    if (fs.existsSync(iconPath)) mainWindow.setIcon(iconPath);
  } catch {
    // El icono empaquetado ya se usa en el exe.
  }

  const wc = mainWindow.webContents;
  wc.on('did-fail-load', (e, code, desc, validated) => console.log('[main] did-fail-load', code, desc, validated));
  wc.on('render-process-gone', (e, details) => console.log('[main] render-process-gone', JSON.stringify(details)));
  wc.on('did-finish-load', () => console.log('[main] did-finish-load', wc.getURL()));

  if (url.startsWith('http') || url.startsWith('file://')) {
    mainWindow.loadURL(url);
  } else if (fs.existsSync(url)) {
    mainWindow.loadFile(url);
  } else {
    mainWindow.loadURL(pathToFileURL(url).href);
  }
}

app.whenReady().then(async () => {
  const requested = safeStartUrl(process.env.ELECTRON_START_URL);
  const url = requested || ((await isDevServerRunning()) ? DEV_SERVER_URL : resolveStartUrl());
  createWindow(url);
  app.on('activate', () => {
    if (!mainWindow) createWindow(url);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
