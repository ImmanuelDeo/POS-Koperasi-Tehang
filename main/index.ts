import { app, BrowserWindow, ipcMain, dialog, Menu, Tray, nativeImage, shell, session } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { Bonjour } from 'bonjour-service';
import { initDatabase, closeDatabase } from './db';
import { startServer, stopServer, getLocalIP, isServerRunning } from './server';
import { startKdsServer, stopKdsServer, getKdsPort, isKdsServerRunning } from './kds-server';
import { initPrinter, printReceipt, printKOT } from './printers/thermal';
import { registerIpcHandlers } from './ipc';
import log from 'electron-log/main';
import { autoUpdater } from 'electron-updater';
import { isAutoUpdaterEnabled, isKioskModeEnabled, isLocalAppOrigin } from './config/security';
// Override userData directory if explicitly requested via environment variable (for isolated testing)
const customUserDataDir = process.env.FLO_USER_DATA_DIR?.trim();
if (customUserDataDir) {
  const resolvedUserData = path.resolve(customUserDataDir);
  if (!fs.existsSync(resolvedUserData)) {
    fs.mkdirSync(resolvedUserData, { recursive: true });
  }
  app.setPath('userData', resolvedUserData);
  console.log('[Flo] Isolated user data directory set:', resolvedUserData);
}

log.initialize();
log.transports.file.level = 'info';
log.transports.console.level = 'debug';
const logPath = log.transports.file.getFile().path.replace(/[^\/\\]+$/, '');
console.log('[Log] Log files location:', logPath);

let updateAvailable = false;
let updateDownloaded = false;

function setupAutoUpdater(): void {
  if (!isAutoUpdaterEnabled()) {
    console.log('[Updater] Auto-updater disabled by security policy (offline/local mode)');
    return;
  }

  autoUpdater.logger = log;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('[Update] Checking for updates...');
    mainWindow?.webContents.send('update-status', { status: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[Update] Update available:', info.version);
    updateAvailable = true;
    mainWindow?.webContents.send('update-status', { 
      status: 'available', 
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes 
    });
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Available',
      message: `Flo ${info.version} is available!`,
      detail: `Release date: ${info.releaseDate}\n\nWould you like to download it now?`,
      buttons: ['Download', 'Later'],
      defaultId: 0,
    }).then((result) => {
      if (result.response === 0) {
        autoUpdater.downloadUpdate();
      }
    });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[Update] No updates available');
    mainWindow?.webContents.send('update-status', { status: 'up-to-date' });
  });

  autoUpdater.on('download-progress', (progress) => {
    console.log(`[Update] Download progress: ${progress.percent.toFixed(1)}%`);
    mainWindow?.webContents.send('update-status', { 
      status: 'downloading',
      percent: progress.percent 
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[Update] Download complete:', info.version);
    updateDownloaded = true;
    mainWindow?.webContents.send('update-status', { 
      status: 'ready-to-install',
      version: info.version
    });
    dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: 'Update downloaded successfully!',
      detail: `Version ${info.version} is ready to install.\n\nThe update will be installed when you quit the app.`,
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
    }).then((result) => {
      if (result.response === 0) {
        isQuitting = true;
        autoUpdater.quitAndInstall();
      }
    });
  });

  autoUpdater.on('error', (err) => {
    // 404 means no release artifacts published yet — treat as "up to date", not an error.
    const is404 = err.message?.includes('404') || err.message?.includes('Cannot find latest');
    if (is404) {
      log.debug('[Update] No release artifacts found (404) — skipping update');
      mainWindow?.webContents.send('update-status', { status: 'up-to-date' });
    } else {
      log.error('[Update] Error:', err);
      mainWindow?.webContents.send('update-status', { status: 'error', error: err.message });
    }
  });
}

function checkForUpdates(): void {
  if (!isAutoUpdaterEnabled()) {
    return;
  }
  if (!isDev) {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[Update] Check failed:', err);
    });
  } else {
    log.debug('[Update] Skipping update check in dev mode');
    mainWindow?.webContents.send('update-status', { status: 'dev-mode' });
  }
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let bonjour: Bonjour | null = null;
let isQuitting = false;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const PORT = parseInt(process.env.PORT || '3001', 10);

function createWindow(): void {
  const kioskActive = isKioskModeEnabled();

  if (kioskActive) {
    mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      kiosk: true,
      fullscreen: true,
      resizable: false,
      frame: false,
      autoHideMenuBar: true,
      title: 'Flo POS Koperasi',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        devTools: false,
      },
      show: false,
    });
  } else {
    mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 1024,
      minHeight: 768,
      resizable: true,
      frame: true,
      fullscreen: false,
      kiosk: false,
      title: 'Flo',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        devTools: isDev,
      },
      show: false,
    });
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Always load from the embedded Express server (serves static Next.js export).
  mainWindow.loadURL(`http://localhost:${PORT}`);

  // Navigation restriction: only allow local app origin
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!isDev && !isLocalAppOrigin(navigationUrl, PORT)) {
      console.warn('[Security] Blocked unauthorized navigation attempt:', navigationUrl);
      event.preventDefault();
    }
  });

  // Shortcut blocking and admin recovery hotkey for production kiosk mode
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (isKioskModeEnabled()) {
      const key = input.key.toUpperCase();
      const isCtrlOrCmd = input.control || input.meta;

      // Admin Recovery shortcut: Ctrl+Shift+X
      if (isCtrlOrCmd && input.shift && key === 'X') {
        event.preventDefault();
        mainWindow?.webContents.send('open-admin-exit-modal');
        return;
      }

      // Block browser reload: F5, Ctrl+R, Ctrl+Shift+R
      if (key === 'F5' || (isCtrlOrCmd && key === 'R')) {
        event.preventDefault();
        return;
      }

      // Block DevTools shortcuts: F12, Ctrl+Shift+I
      if (key === 'F12' || (isCtrlOrCmd && input.shift && key === 'I')) {
        event.preventDefault();
        return;
      }

      // Block history navigation: Alt+Left, Alt+Right
      if (input.alt && (key === 'ARROWLEFT' || key === 'ARROWRIGHT')) {
        event.preventDefault();
        return;
      }

      // Intercept Alt+F4: reveal Admin Recovery dialog instead of closing
      if (input.alt && key === 'F4') {
        event.preventDefault();
        mainWindow?.webContents.send('open-admin-exit-modal');
        return;
      }
    }
  });

  // Allow target="_blank" links to open new windows for local URLs (e.g. the KDS page).
  // External URLs are sent to the system browser instead.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const isLocal = url.startsWith(`http://localhost:${PORT}`) ||
                    url.startsWith(`http://127.0.0.1:${PORT}`) ||
                    url.startsWith(`http://${getLocalIP()}:${PORT}`);
    if (isLocal) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1280,
          height: 800,
          title: 'Flo - Kitchen Display',
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
          },
        },
      };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      if (isKioskModeEnabled()) {
        event.preventDefault();
        mainWindow?.webContents.send('open-admin-exit-modal');
        return;
      }
      // Normal close in development & production non-kiosk
      isQuitting = true;
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    log.error('[Window] Renderer process gone:', details.reason);
    console.error('[Window] Renderer process gone:', details.reason);
    
    if (details.reason !== 'clean-exit') {
      dialog.showMessageBox({
        type: 'error',
        title: 'App Crashed',
        message: 'The app crashed and will restart.',
        detail: `Reason: ${details.reason}`,
        buttons: ['OK'],
      }).then(() => {
        mainWindow?.destroy();
        mainWindow = null;
        createWindow();
      });
    }
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    log.error('[Window] Failed to load:', errorCode, errorDescription);
    console.error('[Window] Failed to load:', errorCode, errorDescription);
  });

  mainWindow.webContents.on('unresponsive', () => {
    console.warn('[Window] Window became unresponsive');
  });

  mainWindow.webContents.on('responsive', () => {
    console.log('[Window] Window became responsive again');
  });
}


function createTray(): void {
  // In production kiosk mode, do not create system tray to prevent bypassing kiosk
  if (isKioskModeEnabled()) {
    return;
  }

  const iconPath = isDev
    ? path.join(__dirname, '../../assets/icon.png')
    : path.join(process.resourcesPath, 'assets/icon.png');

  try {
    const icon = nativeImage.createFromPath(iconPath);
    tray = new Tray(icon.resize({ width: 16, height: 16 }));

    const contextMenu = Menu.buildFromTemplate([
      { label: 'Open Flo', click: () => mainWindow?.show() },
      { type: 'separator' },
      { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
    ]);

    tray.setToolTip('Flo');
    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => mainWindow?.show());
  } catch {
    console.log('[Tray] Icon not found, skipping tray');
  }
}

function startMdns(): void {
  try {
    bonjour = new Bonjour();
    bonjour.publish({
      name: 'Flo',
      type: 'http',
      port: PORT,
      host: 'flo',   // resolves as flo.local on the LAN
      txt: { version: app.getVersion(), kds: `/kds`, kds_port: String(getKdsPort()) },
    });
    const ip = getLocalIP();
    console.log(`[mDNS] Advertising flo.local:${PORT}  (IP fallback: http://${ip}:${PORT})`);
    console.log(`[mDNS] KDS available at http://flo.local:${getKdsPort()}  (IP fallback: http://${ip}:${getKdsPort()})`);
  } catch (err) {
    console.warn('[mDNS] Could not start Bonjour:', err);
  }
}

function stopMdns(): void {
  if (bonjour) {
    bonjour.unpublishAll(() => bonjour?.destroy());
    bonjour = null;
  }
}

function createMenu(): void {
  // In production kiosk mode, disable top application menu completely
  if (isKioskModeEnabled()) {
    Menu.setApplicationMenu(null);
    return;
  }

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'New Order', accelerator: 'CmdOrCtrl+N', click: () => mainWindow?.webContents.send('new-order') },
        { label: 'Quick Search', accelerator: 'CmdOrCtrl+K', click: () => mainWindow?.webContents.send('quick-search') },
        { type: 'separator' },
        { label: 'Backup Database', click: () => mainWindow?.webContents.send('backup-database') },
        { label: 'Restore Backup', click: () => mainWindow?.webContents.send('restore-backup') },
        { type: 'separator' },
        { label: 'Exit', accelerator: 'CmdOrCtrl+Q', click: () => { isQuitting = true; app.quit(); } },
      ],
    },
    {
      label: 'Orders',
      submenu: [
        { label: 'View All Orders', accelerator: 'CmdOrCtrl+O', click: () => mainWindow?.webContents.send('view-orders') },
      ],
    },
    {
      label: 'Reports',
      submenu: [
        { label: 'Daily Summary', click: () => mainWindow?.webContents.send('report-daily') },
        { label: 'Sales Report', click: () => mainWindow?.webContents.send('report-sales') },
        { label: 'X Report', click: () => mainWindow?.webContents.send('report-x') },
        { label: 'Z Report', click: () => mainWindow?.webContents.send('report-z') },
      ],
    },
    {
      label: 'Settings',
      submenu: [
        { label: 'Business Settings', click: () => mainWindow?.webContents.send('settings-business') },
        { label: 'Tax Settings', click: () => mainWindow?.webContents.send('settings-tax') },
        { label: 'Printer Setup', click: () => mainWindow?.webContents.send('settings-printer') },
        { label: 'Kitchen Stations', click: () => mainWindow?.webContents.send('settings-kitchen') },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'About Flo', click: () => showAbout() },
        { label: 'Check for Updates', click: () => checkForUpdates() },
      ],
    },
  ];

  if (isDev) {
    template.push({
      label: 'Developer',
      submenu: [
        { label: 'Toggle DevTools', accelerator: 'F12', click: () => mainWindow?.webContents.toggleDevTools() },
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.webContents.reload() },
      ],
    });
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function showAbout(): void {
  const ip = getLocalIP();
  const kdsPort = getKdsPort();
  dialog.showMessageBox({
    type: 'info',
    title: 'About Flo',
    message: 'Flo Desktop',
    detail: [
      `Version: ${app.getVersion()}`,
      `Electron: ${process.versions.electron}`,
      `Node: ${process.versions.node}`,
      '',
      'A self-hosted, offline-first Point of Sale system.',
      'Your data stays yours.',
      '',
      `POS URL: http://flo.local:${PORT}`,
      `KDS URL: http://flo.local:${kdsPort}`,
      '',
      `KDS IP fallback: http://${ip}:${kdsPort}`,
    ].join('\n'),
  });
}

async function initialize(): Promise<void> {
  try {
    console.log('[Flo] Initializing...');

    // Security: deny all unexpected permission requests
    session.defaultSession?.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });

    console.log('[Flo] Initializing database...');
    initDatabase();

    console.log('[Flo] Starting local server...');
    await startServer();

    console.log('[Flo] Starting KDS server on port 3002...');
    await startKdsServer();

    console.log('[Flo] Starting mDNS advertisement...');
    startMdns();

    console.log('[Flo] Initializing printer...');
    await initPrinter();

    console.log('[Flo] Registering IPC handlers...');
    registerIpcHandlers({
      onQuitRequested: () => {
        isQuitting = true;
        app.quit();
      },
    });

    ipcMain.handle('get-update-status', () => ({
      updateAvailable,
      updateDownloaded,
      version: app.getVersion(),
    }));

    ipcMain.handle('check-for-updates', () => {
      checkForUpdates();
    });

    ipcMain.handle('get-status', () => {
      const mem = process.memoryUsage();
      return {
        server: isServerRunning() ? 'running' : 'stopped',
        memory: {
          heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
          heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
          rss: Math.round(mem.rss / 1024 / 1024),
        },
        uptime: process.uptime(),
        port: PORT,
      };
    });

    console.log('[Flo] Setting up menu and window...');
    createMenu();
    createWindow();
    createTray();

    if (isAutoUpdaterEnabled()) {
      setupAutoUpdater();
      setTimeout(() => checkForUpdates(), 5000);
    } else {
      console.log('[Flo] Offline mode: Auto-updater is disabled by security policy');
    }

    console.log('[Flo] Ready!');
  } catch (error) {
    console.error('[Flo] Initialization error:', error);
    dialog.showErrorBox('Initialization Error', `Failed to start Flo: ${error}`);
    app.quit();
  }
}


app.whenReady().then(initialize);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  } else {
    mainWindow.show();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('quit', () => {
  console.log('[Flo] Shutting down...');
  stopMdns();
  stopKdsServer();
  stopServer();
  closeDatabase();
  console.log('[Flo] Goodbye!');
});

process.on('uncaughtException', (error) => {
  log.error('[Flo] Uncaught exception:', error);
  console.error('[Flo] Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  log.error('[Flo] Unhandled rejection:', reason);
  console.error('[Flo] Unhandled rejection:', reason);
});
