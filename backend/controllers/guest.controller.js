import { launchTemplate as launchApps } from "../utils/launcher.util.js";

const extractApps = (payload = {}) => {
  if (!Array.isArray(payload.apps)) return [];
  return payload.apps
    .map((app) => (typeof app === "string" ? app.trim() : ""))
    .filter(Boolean);
};

const extractAppLaunchers = (payload = {}) => {
  if (!Array.isArray(payload.appLaunchers)) return [];
  return payload.appLaunchers.filter((entry) => entry && typeof entry === "object");
};

export const launchGuestTemplate = async (req, res) => {
  try {
    const template = req.body || {};
    const apps = extractApps(template);
    const appLaunchers = extractAppLaunchers(template);

    if (!apps.length && !appLaunchers.length) {
      return res
        .status(400)
        .json({ success: false, message: "No apps provided to launch" });
    }

    await launchApps({ apps, appLaunchers });

    res.json({
      success: true,
      message: "Guest template launch triggered",
      launched: appLaunchers.length || apps.length,
    });
  } catch (error) {
    console.error("❌ Guest launch failed:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to launch guest template",
      error: error.message,
    });
  }
};
