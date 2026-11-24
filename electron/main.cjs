/* Proceso principal del escritorio (Electron). Carga el servidor de desarrollo
   de CRA si está corriendo (localhost:3000), si no, carga el build de producción. */
const http = require('http');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { app, BrowserWindow } = require('electron');

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
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return path.join(__dirname, '..', 'build', 'index.html');
}

let mainWindow = null;

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  try {
    const iconPath = path.join(__dirname, '..', 'build', 'icon.ico');
    if (fs.existsSync(iconPath)) {
      mainWindow.setIcon(iconPath);
    }
  } catch {
    // El icono empaquetado ya se usa en el exe; esto es solo para el window de desarrollo.
  }

  const wc = mainWindow.webContents;

  wc.on('did-fail-load', (e, code, desc, validated) => {
    console.log('[main] did-fail-load', code, desc, validated);
  });
  wc.on('did-fail-provisional-load', (e, code, desc, validated) => {
    console.log('[main] did-fail-provisional-load', code, desc, validated);
  });
  wc.on('console-message', (event) => {
    console.log('[main] page console:', String(event.message));
  });
  wc.on('render-process-gone', (e, details) => {
    console.log('[main] render-process-gone', JSON.stringify(details));
  });

  function dump(tag) {
    wc.executeJavaScript(
      "(function(){var d=document;var r=d.querySelector('#root');return {ready:d.readyState,title:d.title,rootKids:(r?r.children.length:-1),rootHTML:(r?r.innerHTML.slice(0,400):''),bodyText:(d.body?d.body.innerText.slice(0,300):''),scripts:d.scripts.length};})()"
    )
      .then((t) => console.log(`[main] ${tag}:`, JSON.stringify(t)))
      .catch((e) => console.log(`[main] ${tag} error:`, e && e.message));
  }

  wc.on('did-finish-load', () => {
    console.log('[main] did-finish-load');
    console.log('[main] url:', wc.getURL());
    dump('after-load');
  });

  setTimeout(() => dump('after-5s'), 5000);

  if (url.startsWith('http')) {
    console.log('[main] loadURL:', url);
    mainWindow.loadURL(url);
  } else if (fs.existsSync(url)) {
    console.log('[main] loadFile:', url);
    mainWindow.loadFile(url);
  } else {
    console.log('[main] loadURL (file fallback):', url);
    mainWindow.loadURL(pathToFileURL(url).href);
  }
}

app.whenReady().then(async () => {
  let url = process.env.ELECTRON_START_URL;
  if (!url) {
    url = (await isDevServerRunning()) ? DEV_SERVER_URL : resolveStartUrl();
  }
  createWindow(url);
  app.on('activate', () => {
    if (!mainWindow) createWindow(url);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
