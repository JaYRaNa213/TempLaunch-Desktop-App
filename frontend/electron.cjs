

// electron.cjs
const { app, BrowserWindow, BrowserView, ipcMain } = require("electron");
const path = require("path");
const { existsSync, readdirSync } = require("fs");
const { spawn } = require("child_process");

const isDev = !app.isPackaged;
let win;
let tabs = [];
let activeTabIndex = -1;
let workspaceVisible = false;
let tabIdCounter = 0;

const CONTENT_TOP_OFFSET = 160;
let customContentBounds = null;

const shouldApplyAppCSP = (urlString = "") => {
  try {
    const parsed = new URL(urlString);
    return parsed.protocol === "file:" || parsed.hostname === "localhost";
  } catch (err) {
    return true;
  }
};

const normalizeUrl = (input = "") => {
  const trimmed = input.trim();
  if (!trimmed) return "https://www.google.com";
  const hasScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed);
  return hasScheme ? trimmed : `https://${trimmed}`;
};

const sanitizeArgs = (args = []) =>
  Array.isArray(args)
    ? args.map((arg) => (typeof arg === "string" ? arg.trim() : "")).filter(Boolean)
    : [];

const normalizeAppEntry = (entry, index = 0) => {
  if (!entry) return null;

  if (typeof entry === "string") {
    const trimmed = entry.trim();
    if (!trimmed) return null;
    return {
      id: `app-${index}`,
      path: trimmed,
      args: [],
      mode: "generic",
    };
  }

  if (typeof entry === "object") {
    const rawPath = entry.path || entry.executable || entry.command || "";
    const pathValue = typeof rawPath === "string" ? rawPath.trim() : "";
    if (!pathValue) return null;

    const mode =
      entry.mode === "vscode" ||
      entry.isVSCode ||
      (entry.folderPath && !entry.mode)
        ? "vscode"
        : "generic";

    const folderPath =
      typeof entry.folderPath === "string" ? entry.folderPath.trim() : "";

    const normalizedArgs = sanitizeArgs(entry.args);
    const computedArgs =
      mode === "vscode" && folderPath
        ? ["-n", folderPath, ...normalizedArgs]
        : normalizedArgs;

    return {
      id: entry.id || entry.key || `app-${index}`,
      path: pathValue,
      args: computedArgs,
      cwd:
        typeof entry.cwd === "string" && entry.cwd.trim().length
          ? entry.cwd.trim()
          : undefined,
      mode,
    };
  }

  return null;
};

const sanitizeAppEntries = (apps = []) =>
  (Array.isArray(apps) ? apps : [])
    .map((entry, index) => normalizeAppEntry(entry, index))
    .filter(Boolean);

const resolveExecutablePath = (appPathRaw) => {
  if (typeof appPathRaw !== "string") return "";
  const appPath = appPathRaw.trim();
  if (!appPath) return "";

  if (existsSync(appPath)) return appPath;

  const dir = path.dirname(appPath);
  const base = path.basename(appPath).toLowerCase();

  if (dir && existsSync(dir)) {
    const match = readdirSync(dir).find((f) => f.toLowerCase() === base);
    if (match) return path.join(dir, match);
  }

  return appPath;
};

const launchApp = async (rawEntry) => {
  if (!rawEntry) return false;

  const entry =
    typeof rawEntry === "string"
      ? { path: rawEntry.trim(), args: [] }
      : rawEntry;

  const appPath = typeof entry.path === "string" ? entry.path.trim() : "";
  if (!appPath) return false;

  const resolved = resolveExecutablePath(appPath);
  const isExePath = resolved.endsWith(".exe") && existsSync(resolved);
  const args = Array.isArray(entry.args) ? entry.args : [];
  const cwd =
    typeof entry.cwd === "string" && entry.cwd.trim().length
      ? entry.cwd.trim()
      : undefined;

  if (isExePath) {
    try {
      spawn(resolved, args, {
        detached: true,
        stdio: "ignore",
        shell: true,
        cwd,
      }).unref();
      console.log(`✅ Launched app: ${resolved}`);
      return true;
    } catch (err) {
      console.error(`❌ Failed to launch app: ${resolved}`, err.message);
      return false;
    }
  }

  try {
    spawn(appPath, args, {
      detached: true,
      stdio: "ignore",
      shell: true,
      cwd,
    }).unref();
    console.log(`✅ Opened CLI app: ${appPath}`);
    return true;
  } catch (err) {
    console.error(`❌ Failed to open CLI app: ${appPath}`, err.message);
    return false;
  }
};

const sanitizeTabsForRenderer = () =>
  tabs.map(({ id, url, title }) => ({
    id,
    url,
    title,
  }));

const sendTabsUpdate = () => {
  if (!win) return;
  win.webContents.send("tabs:update", {
    tabs: sanitizeTabsForRenderer(),
    activeTabIndex,
    workspaceVisible,
  });
};

const getDefaultContentBounds = () => {
  if (!win) return null;
  const [width, height] = win.getContentSize();
  return {
    x: 0,
    y: CONTENT_TOP_OFFSET,
    width,
    height: Math.max(0, height - CONTENT_TOP_OFFSET),
  };
};

const getActiveContentBounds = () => customContentBounds || getDefaultContentBounds();

const setViewBounds = (view) => {
  if (!win || !view) return;
  const bounds = getActiveContentBounds();
  if (!bounds) return;
  view.setBounds(bounds);
  view.setAutoResize({ width: true, height: true });
};

const detachView = (view) => {
  if (!win || !view) return;
  try {
    win.removeBrowserView(view);
  } catch (err) {
    // ignore
  }
};

const refreshVisibleTabs = () => {
  if (!win) return;
  tabs.forEach((tab, index) => {
    const isActive = index === activeTabIndex;
    if (workspaceVisible && isActive) {
      try {
        win.addBrowserView(tab.view);
        setViewBounds(tab.view);
      } catch (err) {
        // ignore
      }
    } else {
      detachView(tab.view);
    }
  });
  sendTabsUpdate();
};

const attachTabListeners = (tab) => {
  const { view } = tab;
  if (!view) return;

  const updateMetadata = () => {
    tab.url = view.webContents.getURL();
    tab.title = view.webContents.getTitle() || tab.url;
    sendTabsUpdate();
  };

  view.webContents.on("did-navigate", updateMetadata);
  view.webContents.on("page-title-updated", (_, title) => {
    tab.title = title || tab.url;
    sendTabsUpdate();
  });
  view.webContents.on("did-fail-load", (event, errorCode, errorDescription) => {
    tab.title = `Failed: ${errorDescription} (${errorCode})`;
    sendTabsUpdate();
  });
};

// ✅ Disable noisy security warnings in development
if (isDev) process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
   icon: path.join(process.resourcesPath, "icons", "icon.ico"),
    frame: false,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#111111",
      symbolColor: "#ffffff",
      height: 32,
    },
    autoHideMenuBar: true,
    backgroundColor: "#1e1e1e",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  //  Try to load Vite (for dev)
  const devUrl = "http://localhost:5173";
  win
    .loadURL(devUrl)
    .catch(() => {
      console.log("⚠️ Dev server not running. Loading production build...");
      win.loadFile(path.join(__dirname, "dist", "index.html"));
    });

  // ✅ Optional DevTools toggle
  win.webContents.on("before-input-event", (event, input) => {
    if ((input.control || input.meta) && input.shift && input.key.toLowerCase() === "i") {
      win.webContents.isDevToolsOpened()
        ? win.webContents.closeDevTools()
        : win.webContents.openDevTools({ mode: "detach" });
    }
  });

  // ✅ Suppress Autofill spam
  win.webContents.on("console-message", (event) => {
  const message = event.message;
  if (message.includes("Autofill")) event.preventDefault();
});

  // ✅ CSP for production
  if (!isDev) {
    const appContentSecurityPolicy = [
      "default-src 'self' https: data: blob:;",
      "script-src 'self' https://contextswap-backend.onrender.com 'unsafe-inline';",
      "style-src 'self' 'unsafe-inline' https:;",
      "img-src 'self' data: https://contextswap-backend.onrender.com https:;",
      "connect-src 'self' https://contextswap-backend.onrender.com https:;",
      "font-src 'self' data: https:;",
      "object-src 'none'; frame-ancestors 'none';",
    ].join(" ");

    win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      if (shouldApplyAppCSP(details.url)) {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            "Content-Security-Policy": [appContentSecurityPolicy],
          },
        });
      } else {
        callback({ responseHeaders: details.responseHeaders });
      }
    });
  }
  win.on("resize", () => {
    const activeTab = tabs[activeTabIndex];
    if (activeTab) {
      setViewBounds(activeTab.view);
    }
  });
}

const ensureActiveIndexWithinBounds = () => {
  if (tabs.length === 0) {
    activeTabIndex = -1;
    return;
  }
  if (activeTabIndex < 0) activeTabIndex = 0;
  if (activeTabIndex >= tabs.length) activeTabIndex = tabs.length - 1;
};

const setWorkspaceVisibility = (visible) => {
  workspaceVisible = Boolean(visible);
  refreshVisibleTabs();
  return workspaceVisible;
};

const hideAllBrowserViews = () => {
  tabs.forEach(({ view }) => detachView(view));
  workspaceVisible = false;
  sendTabsUpdate();
};

const restoreActiveBrowserView = () => {
  if (!tabs.length) {
    workspaceVisible = false;
    sendTabsUpdate();
    return false;
  }
  ensureActiveIndexWithinBounds();
  workspaceVisible = true;
  refreshVisibleTabs();
  return true;
};

/* ---------------- IPC Window Controls ---------------- */
ipcMain.on("close-window", () => {
  const currentWindow = BrowserWindow.getFocusedWindow();
  if (currentWindow) currentWindow.close();
});

ipcMain.on("minimize-window", () => {
  const currentWindow = BrowserWindow.getFocusedWindow();
  if (currentWindow) currentWindow.minimize();
});

ipcMain.on("maximize-window", () => {
  const currentWindow = BrowserWindow.getFocusedWindow();
  if (currentWindow) {
    currentWindow.isMaximized()
      ? currentWindow.unmaximize()
      : currentWindow.maximize();
  }
});

/* ---------------- TAB MANAGEMENT ---------------- */
ipcMain.handle("create-tab", (event, rawUrl) => {
  if (!win) return;
  const view = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const tab = {
    id: ++tabIdCounter,
    url: normalizeUrl(rawUrl || "https://www.google.com"),
    title: "Loading...",
    view,
  };

  tabs.push(tab);
  activeTabIndex = tabs.length - 1;
  attachTabListeners(tab);
  refreshVisibleTabs();
  view.webContents.loadURL(tab.url);
});

ipcMain.handle("switch-tab", (event, index) => {
  if (!tabs[index]) return;
    activeTabIndex = index;
  refreshVisibleTabs();
});

ipcMain.handle("close-tab", (event, index) => {
  if (!tabs[index]) return;

  const [removed] = tabs.splice(index, 1);
  try {
    if (removed.view) {
      win.removeBrowserView(removed.view);
      removed.view.webContents.destroy();

    }
  } catch (err) {
    console.warn("⚠️ Failed to clean up tab view:", err.message);
  }

  ensureActiveIndexWithinBounds();
  refreshVisibleTabs();
});

ipcMain.handle("reload-tab", (event, index) => {
  const target = tabs[index];
  if (target?.view) {
    target.view.webContents.reload();
  }
});

ipcMain.handle("tabs:get-state", () => ({
  tabs: sanitizeTabsForRenderer(),
  activeTabIndex,
  workspaceVisible,
}));

ipcMain.handle("tabs:update-bounds", (event, bounds) => {
  if (!bounds || typeof bounds !== "object") {
    customContentBounds = null;
  } else {
    const sanitized = {
      x: Math.max(0, Math.floor(bounds.x ?? 0)),
      y: Math.max(0, Math.floor(bounds.y ?? 0)),
      width: Math.max(0, Math.floor(bounds.width ?? 0)),
      height: Math.max(0, Math.floor(bounds.height ?? 0)),
    };
    customContentBounds = sanitized;
  }
  refreshVisibleTabs();
});

ipcMain.handle("tabs:set-visibility", (event, visible) => {
  return { workspaceVisible: setWorkspaceVisibility(visible) };
});

ipcMain.handle("tabs:hide-all", () => {
  hideAllBrowserViews();
  return { workspaceVisible };
});

ipcMain.handle("tabs:restore-active", () => {
  const restored = restoreActiveBrowserView();
  return { workspaceVisible, restored };
});

ipcMain.handle("launch-apps", async (event, apps = []) => {
  const sanitized = sanitizeAppEntries(apps);
  if (!sanitized.length) {
    return { success: false, message: "No apps provided" };
  }

  let successCount = 0;
  for (const appPath of sanitized) {
    // eslint-disable-next-line no-await-in-loop
    const launched = await launchApp(appPath);
    if (launched) successCount += 1;
  }

  const success = successCount > 0;
  return {
    success,
    launched: successCount,
    requested: sanitized.length,
    message: success
      ? `Launched ${successCount}/${sanitized.length} apps`
      : "Failed to launch any apps",
  };
});

/* ---------------- App Lifecycle ---------------- */
app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
