import Template from "../models/template.model.js";

const normalizeString = (value) =>
  typeof value === "string" ? value.trim() : "";

/**
 * Helper: get guest id from request
 * If none provided, returns null
 */
const extractGuestId = (req) =>
  req.body?.guestId || req.query?.guestId || req.headers["x-guest-id"] || null;

/**
 * Helper to generate a reasonably unique guest id (no external deps)
 * Not cryptographically secure but fine for client-side sticky id usage.
 */
const generateGuestId = () => {
  return `guest_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
};

const sanitizeAppStrings = (apps = []) =>
  Array.isArray(apps)
    ? apps
        .map((app) => (typeof app === "string" ? app.trim() : ""))
        .filter(Boolean)
    : [];

const sanitizeAppLaunchers = (rawEntries = [], fallbackApps = []) => {
  const maybeArray = Array.isArray(rawEntries) ? rawEntries : [];
  const fallback = Array.isArray(fallbackApps) ? fallbackApps : [];

  return maybeArray
    .map((entry, index) => {
      if (!entry) return null;

      if (typeof entry === "string") {
        const trimmed = normalizeString(entry);
        if (!trimmed) return null;
        return {
          path: trimmed,
          args: [],
          mode: "generic",
        };
      }

      if (typeof entry === "object") {
        const rawPath =
          entry.path ||
          entry.executable ||
          entry.command ||
          fallback[index] ||
          "";
        const path = normalizeString(rawPath);
        if (!path) return null;

        const args = Array.isArray(entry.args)
          ? entry.args.map(normalizeString).filter(Boolean)
          : [];
        const folderPath = normalizeString(entry.folderPath || entry.workspaceFolder);
        const mode =
          entry.mode === "vscode" ||
          entry.isVSCode ||
          (!entry.mode && folderPath)
            ? "vscode"
            : "generic";

        return {
          id: normalizeString(entry.id || entry.key) || undefined,
          label: normalizeString(entry.label) || undefined,
          path,
          args,
          cwd: normalizeString(entry.cwd) || undefined,
          mode,
          folderPath: folderPath || undefined,
        };
      }

      return null;
    })
    .filter(Boolean);
};

const buildDefaultAppLaunchers = (apps = []) => {
  if (!Array.isArray(apps)) return [];
  return sanitizeAppLaunchers(
    apps.map((app) => (typeof app === "string" ? app : "")),
    apps
  );
};

// Build payload for createTemplate; if no guestId provided, we generate one
const buildTemplatePayload = (req) => {
  const {
    title,
    description,
    apps = [],
    websites = [],
    schedule = null,
    appLaunchers = [],
  } = req.body || {};

  const sanitizedAppStrings = sanitizeAppStrings(apps);

  const payload = {
    title,
    description,
    apps: sanitizedAppStrings,
    websites,
    schedule,
    usageCount: 0,
  };

  const sanitizedLaunchers = sanitizeAppLaunchers(
    appLaunchers,
    sanitizedAppStrings
  );
  payload.appLaunchers =
    sanitizedLaunchers.length > 0
      ? sanitizedLaunchers
      : buildDefaultAppLaunchers(sanitizedAppStrings);

  if (!sanitizedAppStrings.length && payload.appLaunchers.length) {
    payload.apps = payload.appLaunchers.map((launcher) => launcher.path);
  }

  if (req.user) {
    payload.userId = req.user._id || req.user.id;
    payload.userType = "member";
    payload.guestId = null;
    payload.guestName = null;
  } else {
    // accept provided guestId or generate a new one
    const incomingGuestId = extractGuestId(req);
    const resolvedGuestId = incomingGuestId || generateGuestId();
    payload.userType = "guest";
    payload.guestId = resolvedGuestId;
    payload.guestName = req.body?.guestName || req.headers["x-guest-name"] || "Guest User";
  }

  return payload;
};


// Create a new template (works for guests + members)
export const createTemplate = async (req, res, next) => {
  try {
    const payload = buildTemplatePayload(req);

    if (!payload.title) {
      return res.status(400).json({ message: "Title is required" });
    }

    const hasApps = Array.isArray(payload.apps) && payload.apps.length > 0;
    const hasWebsites = Array.isArray(payload.websites) && payload.websites.length > 0;

    if (!hasApps && !hasWebsites) {
      return res.status(400).json({ message: "Add at least one app or website" });
    }

    const newTemplate = await Template.create(payload);

    // If we generated a guestId server-side and the client did not provide it,
    // return it in a response header so the frontend can persist it (localStorage).
    if (!req.body?.guestId && !req.query?.guestId && !req.headers["x-guest-id"] && payload.guestId) {
      res.setHeader("x-guest-id", payload.guestId);
    }

    res.status(201).json(newTemplate);
  } catch (err) {
    console.error("❌ Create Template Error:", err.message);
    next(err);
  }
};


// Get all templates — if user exists, return user's templates; if guestId provided, return guest templates; otherwise return all
export const getAllTemplates = async (req, res, next) => {
  try {
    const { limit } = req.query;
    const queryFilter = {};

    if (req.user) {
      queryFilter.userId = req.user._id || req.user.id;
    } else {
      const guestId = extractGuestId(req);
      if (guestId) {
        queryFilter.guestId = guestId;
      } 
      // else: no user and no guestId → return all templates (public)
    }

    let query = Template.find(queryFilter).sort({ usageCount: -1, updatedAt: -1 });
    if (limit) query = query.limit(Number(limit));

    const templates = await query.exec();
    res.json(templates);
  } catch (err) {
    console.error("❌ Get All Templates Error:", err.message);
    next(err);
  }
};

// Get single template by id — fully public
export const getTemplateById = async (req, res, next) => {
  try {
    const template = await Template.findById(req.params.id);

    if (!template) {
      return res.status(404).json({ message: "Template not found" });
    }

    res.json(template);
  } catch (err) {
    console.error("❌ Get Template By ID Error:", err.message);
    next(err);
  }
};

// Increment usage — no ownership checks
export const incrementUsage = async (req, res, next) => {
  try {
    const template = await Template.findById(req.params.id);
    if (!template) {
      return res.status(404).json({ message: "Template not found" });
    }

    template.usageCount = (template.usageCount || 0) + 1;
    await template.save();

    res.json(template);
  } catch (err) {
    console.error("❌ Increment Usage Error:", err.message);
    next(err);
  }
};

// Launch template (record usage) — no actual launching on server, just record & return
export const launchTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await Template.findById(id);
    if (!template) {
      return res.status(404).json({ error: "Template not found" });
    }

    template.usageCount = (template.usageCount || 0) + 1;
    await template.save();

    res.json({ message: "Template launch recorded" });
  } catch (err) {
    console.error("🚨 Launch Error:", err.message);
    res.status(500).json({ error: "Launch failed", details: err.message });
  }
};

// Delete template — public (anyone can delete) — modify if you later want ownership checks
export const deleteTemplate = async (req, res, next) => {
  try {
    const template = await Template.findById(req.params.id);
    if (!template) {
      return res.status(404).json({ message: "Template not found" });
    }

    await template.deleteOne();
    res.json({ message: "Template deleted successfully" });
  } catch (err) {
    console.error("❌ Delete Template Error:", err.message);
    next(err);
  }
};

// Edit template — public
export const EditTemplate = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      title,
      description,
      apps,
      websites,
      schedule,
      guestName,
      appLaunchers,
    } = req.body || {};

    const template = await Template.findById(id);
    if (!template) {
      return res.status(404).json({ message: "Template not found" });
    }

    if (title !== undefined) template.title = title;
    if (description !== undefined) template.description = description;
    if (apps !== undefined) template.apps = sanitizeAppStrings(apps);
    if (appLaunchers !== undefined) {
      const sanitizedLaunchers = sanitizeAppLaunchers(
        appLaunchers,
        (apps !== undefined ? sanitizeAppStrings(apps) : template.apps) ?? []
      );
      template.appLaunchers =
        sanitizedLaunchers.length > 0
          ? sanitizedLaunchers
          : buildDefaultAppLaunchers(template.apps);
    } else if ((!apps || !apps.length) && template.appLaunchers?.length) {
      template.apps = template.appLaunchers.map((launcher) => launcher.path);
    }
    if (websites !== undefined) template.websites = websites;
    if (schedule !== undefined) template.schedule = schedule;
    if (guestName !== undefined) template.guestName = guestName;

    await template.save();

    res.json({ message: "Template updated successfully", template });
  } catch (err) {
    console.error("❌ Update Template Error:", err.message);
    next(err);
  }
};
