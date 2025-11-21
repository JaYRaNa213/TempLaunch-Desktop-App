// import open from "open";
// import { existsSync, readdirSync } from "fs";
// import { spawn } from "child_process";
// import path from "path";

// /**
//  * Normalize all types of URLs or schemes (http, mailto, tel, ftp, custom)
//  */
// const normalizeUrl = (input) => {
//   const trimmed = input.trim();
//   const hasScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed);
//   return hasScheme ? trimmed : "https://" + trimmed;
// };

// /**
//  * Try to resolve and normalize executable path
//  */
// const resolveExecutablePath = (appPath) => {
//   if (existsSync(appPath)) return appPath;

//   const dir = path.dirname(appPath);
//   const base = path.basename(appPath).toLowerCase();

//   if (existsSync(dir)) {
//     const match = readdirSync(dir).find((f) => f.toLowerCase() === base);
//     if (match) return path.join(dir, match);
//   }

//   return appPath;
// };

// /**
//  * Launch a local app (.exe or CLI)
//  */
// const launchApp = async (rawApp) => {
//   const app = rawApp.trim();
//   if (!app) return;

//   const resolved = resolveExecutablePath(app);
//   const isExePath = resolved.endsWith(".exe") && existsSync(resolved);

//   if (isExePath) {
//     try {
//       spawn(resolved, [], {
//         detached: true,
//         stdio: "ignore",
//         shell: true, // Required for .exe support on Windows
//       }).unref();
//       console.log(`✅ Launched app: ${resolved}`);
//     } catch (err) {
//       console.error(`❌ Failed to launch app: ${resolved}`, err.message);
//     }
//   } else {
//     try {
//       await open(resolved);
//       console.log(`✅ Opened CLI app: ${resolved}`);
//     } catch (err) {
//       console.error(`❌ Failed to open CLI app: ${resolved}`, err.message);
//     }
//   }
// };

// /**
//  * Launch template: apps + websites
//  */
// export const launchTemplate = async (template) => {
//   try {
//     const { apps = [], websites = [] } = template;

//     for (const app of apps) {
//       await launchApp(app);
//     }

//     for (const raw of websites) {
//       const url = normalizeUrl(raw);
//       await open(url);
//       console.log(`🌐 Opened website: ${url}`);
//     }

//     console.log("🚀 Launch completed successfully");
//   } catch (error) {
//     console.error("🚨 Launcher crashed:", error.message);
//     throw new Error("Could not launch template");
//   }
// };


import { existsSync, readdirSync } from "fs";
import { spawn } from "child_process";
import path from "path";

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

/**
 * Try to resolve and normalize executable path
 */
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

/**
 * Launch a local app (.exe or CLI)
 */
const launchApp = async (rawEntry) => {
  if (!rawEntry) return false;

  const entry =
    typeof rawEntry === "string"
      ? { path: rawEntry.trim(), args: [] }
      : rawEntry;

  const app = typeof entry.path === "string" ? entry.path.trim() : "";
  if (!app) return false;

  const resolved = resolveExecutablePath(app);
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
        shell: true, // Required for .exe support on Windows
        cwd,
      }).unref();
      console.log(`✅ Launched app: ${resolved}`);
      return true;
    } catch (err) {
      console.error(`❌ Failed to launch app: ${resolved}`, err.message);
      return false;
    }
  } else {
    try {
      spawn(app, args, {
        detached: true,
        stdio: "ignore",
        shell: true,
        cwd,
      }).unref();
      console.log(`✅ Opened CLI app: ${app}`);
      return true;
    } catch (err) {
      console.error(`❌ Failed to open CLI app: ${app}`, err.message);
      return false;
    }
  }
};

const extractRawApps = (source = {}) => {
  if (Array.isArray(source)) return source;
  if (source && Array.isArray(source.appLaunchers) && source.appLaunchers.length) {
    return source.appLaunchers;
  }
  if (source && Array.isArray(source.apps)) {
    return source.apps;
  }
  return [];
};

/**
 * Launch template: supports legacy string arrays and structured appLaunchers
 */
export const launchTemplate = async (template = {}) => {
  try {
    const rawEntries = extractRawApps(template);
    const apps = sanitizeAppEntries(rawEntries);
    if (!apps.length) {
      console.warn("⚠️ No valid apps found in template payload");
      return;
    }

    let successCount = 0;

    for (const app of apps) {
      // eslint-disable-next-line no-await-in-loop
      const launched = await launchApp(app);
      if (launched) successCount += 1;
    }

    if (successCount === 0) {
      throw new Error("Every app launch attempt failed");
    }

    console.log(`🚀 Launch completed successfully for ${successCount} app(s)`);
  } catch (error) {
    console.error("🚨 Launcher crashed:", error.message);
    throw new Error("Could not launch apps");
  }
};
