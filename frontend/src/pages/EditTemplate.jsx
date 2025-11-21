// src/pages/EditTemplate.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { getTemplateById, updateTemplate } from "../services/TemplateService";
import {
  LoaderCircle,
  ArrowLeft,
  Edit3,
  AlertTriangle,
  Clock,
  Target,
  Save,
  X,
  Plus,
  Monitor,
  Globe
} from "lucide-react";
import { useAuth } from "../context/AuthContext";

const generateEntryId = () => {
  if (typeof window !== "undefined" && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `app-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const createAppEntry = (overrides = {}) => ({
  id: generateEntryId(),
  path: "",
  folderPath: "",
  extraArgs: "",
  label: "",
  mode: "generic",
  ...overrides,
});

const inferVSCodeMode = (path = "", folderPath = "") => {
  if (folderPath) return "vscode";
  const normalized = path.toLowerCase();
  return normalized.includes("code.exe") || normalized.includes("visual studio code") || normalized === "code"
    ? "vscode"
    : "generic";
};

const mapTemplateAppsToEntries = (template) => {
  if (!template) return [createAppEntry()];

  if (Array.isArray(template.appLaunchers) && template.appLaunchers.length) {
    return template.appLaunchers.map((launcher) =>
      createAppEntry({
        id: launcher.id || launcher._id || generateEntryId(),
        path: launcher.path || launcher.executable || "",
        folderPath: launcher.folderPath || "",
        extraArgs: Array.isArray(launcher.args) ? launcher.args.join(" ") : "",
        label: launcher.label || "",
        mode: launcher.mode || inferVSCodeMode(launcher.path || "", launcher.folderPath || ""),
      })
    );
  }

  if (Array.isArray(template.apps) && template.apps.length) {
    return template.apps.map((app) =>
      createAppEntry({
        path: app,
        mode: inferVSCodeMode(app),
      })
    );
  }

  return [createAppEntry()];
};

export default function EditTemplate() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();

  const [template, setTemplate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);

  // form fields
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [appEntries, setAppEntries] = useState([createAppEntry()]);
  const [websites, setWebsites] = useState([]);
  const [schedule, setSchedule] = useState("");

  // input helpers
  const [newWebsite, setNewWebsite] = useState("");

  useEffect(() => {
    if (!id) {
      setNotFound(true);
      setLoading(false);
      toast.error("Invalid template ID");
      return;
    }

    // Wait for auth context to be ready if needed
    if (authLoading) return;

    const fetchTemplate = async () => {
      setLoading(true);
      try {
        // Use service which handles guest vs user
        const data = await getTemplateById(id, user);
        if (!data) throw new Error("Not found");

        setTemplate(data);
        setTitle(data.title || "");
        setDescription(data.description || "");
        setAppEntries(mapTemplateAppsToEntries(data));
        setWebsites(Array.isArray(data.websites) ? data.websites : []);
        setSchedule(data.schedule || "");
        setNotFound(false);
      } catch (error) {
        console.error("EditTemplate -> fetchTemplate error:", error);
        setNotFound(true);
        toast.error("Template not found.");
      } finally {
        setLoading(false);
      }
    };

    fetchTemplate();
  }, [id, user, authLoading]);

  const handleAddAppEntry = () => {
    setAppEntries((prev) => [...prev, createAppEntry()]);
  };

  const handleAppEntryChange = (index, key, value) => {
    setAppEntries((prev) =>
      prev.map((entry, idx) => {
        if (idx !== index) return entry;
        if (key === "path") {
          const detectedVSCode = inferVSCodeMode(value);
          return {
            ...entry,
            path: value,
            mode:
              entry.mode === "vscode" || entry.folderPath
                ? entry.mode
                : detectedVSCode,
          };
        }
        if (key === "folderPath") {
          return {
            ...entry,
            folderPath: value,
            mode: value ? "vscode" : entry.mode,
          };
        }
        return {
          ...entry,
          [key]: value,
        };
      })
    );
  };

  const toggleVSCodeMode = (index) => {
    setAppEntries((prev) =>
      prev.map((entry, idx) => {
        if (idx !== index) return entry;
        const nextMode = entry.mode === "vscode" ? "generic" : "vscode";
        return {
          ...entry,
          mode: nextMode,
        };
      })
    );
  };

  const handleAddWebsite = () => {
    const value = newWebsite.trim();
    if (!value) {
      toast.error("Please enter a website URL");
      return;
    }
    if (websites.includes(value)) {
      toast.error("Website already added");
      return;
    }
    setWebsites(prev => [...prev, value]);
    setNewWebsite("");
    toast.success("Website added successfully!");
  };

  const removeApp = (appToRemove) => {
    setAppEntries((prev) => {
      if (prev.length <= 1) {
        toast.error("At least one application slot is required.");
        return prev;
      }
      const next = prev.filter((entry) => entry.id !== appToRemove);
      toast.success("Application removed");
      return next.length ? next : [createAppEntry()];
    });
  };

  const removeWebsite = (websiteToRemove) => {
    setWebsites(prev => prev.filter(website => website !== websiteToRemove));
    toast.success("Website removed");
  };

  const handleSave = async () => {
    if (!template) return;

    const sanitizedApps = appEntries
      .map((entry) => ({
        ...entry,
        path: entry.path.trim(),
        folderPath: (entry.folderPath || "").trim(),
        extraArgs: (entry.extraArgs || "").trim(),
        label: (entry.label || "").trim(),
      }))
      .filter((entry) => entry.path.length > 0);

    const hasVSCodeWithoutFolder = sanitizedApps.some(
      (entry) => entry.mode === "vscode" && !entry.folderPath
    );
    if (hasVSCodeWithoutFolder) {
      toast.error("Please provide folder paths for every VS Code entry.");
      return;
    }

    const appsPayload = sanitizedApps.map((entry) => entry.path);
    const appLaunchers = sanitizedApps.map((entry) => ({
      id: entry.id,
      label: entry.label || undefined,
      path: entry.path,
      mode: entry.mode,
      folderPath: entry.mode === "vscode" ? entry.folderPath || undefined : undefined,
      args: entry.extraArgs ? entry.extraArgs.split(/\s+/).filter(Boolean) : [],
    }));

    setSaving(true);
    const updated = {
      ...template,
      title,
      description,
      apps: appsPayload,
      appLaunchers,
      websites,
      schedule: schedule || null,
      updatedAt: new Date().toISOString(),
    };

    try {
      // Pass `user` so service knows whether to hit backend or localStorage
      await updateTemplate(id, updated, user);
      toast.success("Template updated successfully!");
      navigate("/templates");
    } catch (err) {
      console.error("EditTemplate -> handleSave error:", err);
      toast.error("Failed to update template");
    } finally {
      setSaving(false);
    }
  };

  // Loading / Not found states
  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center text-white">
        <LoaderCircle className="w-8 h-8 animate-spin text-purple-400" />
        <span className="ml-3 text-lg">Loading template...</span>
      </div>
    );
  }

  if (notFound || !template) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="bg-gray-800/50 backdrop-blur-xl p-8 rounded-xl border border-red-500 text-center">
          <div className="flex items-center justify-center mb-4">
            <AlertTriangle className="text-red-500 w-8 h-8" />
          </div>
          <h2 className="text-white text-xl font-bold mb-2">Template Not Found</h2>
          <p className="text-gray-400 mb-4">It seems this template doesn't exist or has been deleted.</p>
          <button
            onClick={() => navigate("/templates")}
            className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 transition"
          >
            Back to Templates
          </button>
        </div>
      </div>
    );
  }

  // Main form
  return (
    <div className="min-h-screen bg-[#050505] text-white">
        <div className="sticky top-0 z-20 bg-black/50 backdrop-blur-md border-b border-gray-800 px-6 py-4">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate("/templates")}
                className="w-10 h-10 bg-gray-800/50 hover:bg-gray-700/50 border border-gray-700 rounded-xl flex items-center justify-center transition backdrop-blur-xl"
              >
                <ArrowLeft className="w-5 h-5 text-gray-300" />
              </button>
              <div>
                <h1 className="text-xl font-bold text-white">Edit Template</h1>
                <p className="text-sm text-gray-400">Modify your workspace template settings</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden md:flex items-center gap-4 bg-gray-800/50 backdrop-blur-xl px-4 py-2 rounded-xl border border-gray-700/50">
                <div className="flex items-center gap-2">
                  <Target className="w-4 h-4 text-purple-400" />
                  <span className="text-sm text-white truncate">{template.title}</span>
                </div>
                <div className="w-px h-4 bg-gray-700" />
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-blue-400" />
                  <span className="text-sm text-gray-400">Last modified</span>
                </div>
              </div>
              <div className="flex items-center gap-2 bg-yellow-800/20 px-4 py-2 border border-yellow-600/40 rounded-xl backdrop-blur-xl">
                <Edit3 className="w-4 h-4 text-yellow-400" />
                <span className="text-sm text-yellow-300 font-medium">Edit Mode</span>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-6 py-10 space-y-8">
          {/* Title Field */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-300">Template Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-gray-800/50 backdrop-blur-xl border border-gray-700/50 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-300 shadow-lg"
              placeholder="Enter template title..."
            />
          </div>

          {/* Description Field */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-300">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full px-4 py-3 rounded-xl bg-gray-800/50 backdrop-blur-xl border border-gray-700/50 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-300 shadow-lg resize-none"
              placeholder="Describe your template..."
            />
          </div>

          {/* Applications Section */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-300">Applications</label>
              <button
                type="button"
                onClick={handleAddAppEntry}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white text-sm font-medium transition-all duration-300 shadow-lg hover:shadow-xl"
              >
                <Plus className="w-4 h-4" />
                Add App
              </button>
            </div>

            <div className="space-y-4">
              {appEntries.map((entry, index) => (
                <div
                  key={entry.id}
                  className="space-y-3 rounded-2xl border border-gray-800/70 bg-gray-900/40 p-4 shadow-inner"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex-1 relative">
                      <Monitor className="absolute left-3 top-1/2 -translate-y-1/2 text-purple-400 w-5 h-5" />
                      <input
                        value={entry.path}
                        onChange={(e) => handleAppEntryChange(index, "path", e.target.value)}
                        className="w-full pl-12 pr-4 py-3 rounded-xl bg-black/40 border border-gray-700/60 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-300"
                        placeholder="C:\\Program Files\\Microsoft VS Code\\Code.exe"
                      />
                    </div>
                    {appEntries.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeApp(entry.id)}
                        className="flex items-center justify-center w-10 h-10 rounded-xl bg-red-600/20 border border-red-600/30 text-red-400 hover:bg-red-600/30 transition-all duration-300"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="flex items-center gap-2 text-sm text-gray-300">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-gray-600 bg-gray-900 text-purple-500 focus:ring-purple-500"
                        checked={entry.mode === "vscode"}
                        onChange={() => toggleVSCodeMode(index)}
                      />
                      Launch a VS Code folder with this app
                    </label>
                    <input
                      type="text"
                      value={entry.label}
                      onChange={(e) => handleAppEntryChange(index, "label", e.target.value)}
                      placeholder="Optional nickname (e.g., VS Code - Frontend)"
                      className="w-full px-3 py-2 rounded-lg bg-black/50 border border-gray-700/60 text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
                    />
                  </div>

                  {entry.mode === "vscode" && (
                    <input
                      type="text"
                      value={entry.folderPath}
                      onChange={(e) => handleAppEntryChange(index, "folderPath", e.target.value)}
                      placeholder="Folder to open, e.g., C:\\Projects\\frontend"
                      className="w-full px-4 py-3 rounded-xl bg-black/40 border border-emerald-600/40 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                    />
                  )}

                  <input
                    type="text"
                    value={entry.extraArgs}
                    onChange={(e) => handleAppEntryChange(index, "extraArgs", e.target.value)}
                    placeholder="Additional CLI arguments (optional)"
                    className="w-full px-4 py-3 rounded-xl bg-black/40 border border-gray-700/60 text-white focus:outline-none focus:ring-1 focus:ring-green-500"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Websites Section */}
          <div className="space-y-4">
            <label className="block text-sm font-medium text-gray-300">Websites</label>

            <div className="flex gap-3">
              <div className="flex-1 relative">
                <Globe className="absolute left-3 top-1/2 transform -translate-y-1/2 text-green-400 w-5 h-5" />
                <input
                  value={newWebsite}
                  onChange={(e) => setNewWebsite(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddWebsite()}
                  className="w-full pl-12 pr-4 py-3 rounded-xl bg-gray-800/50 backdrop-blur-xl border border-gray-700/50 text-white focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all duration-300 shadow-lg"
                  placeholder="https://example.com"
                />
              </div>
              <button
                onClick={handleAddWebsite}
                className="px-6 py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white rounded-xl font-medium transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105 flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Add Website
              </button>
            </div>

            {/* Websites List */}
            {websites.length > 0 && (
              <div className="bg-gray-800/30 backdrop-blur-xl border border-gray-700/30 rounded-xl p-4">
                <h4 className="text-sm font-medium text-gray-300 mb-3">Added Websites ({websites.length})</h4>
                <div className="space-y-2">
                  {websites.map((website, index) => (
                    <div key={index} className="flex items-center justify-between bg-gray-700/30 border border-gray-600/30 rounded-lg p-3">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <Globe className="w-4 h-4 text-green-400 flex-shrink-0" />
                        <span className="text-sm text-white truncate">{website}</span>
                      </div>
                      <button onClick={() => removeWebsite(website)} className="ml-3 text-gray-400 hover:text-red-400 transition-colors">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Schedule Field */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-300">Schedule (Cron Expression)</label>
            <input
              type="text"
              placeholder="e.g. 0 9 * * * (every day at 9 AM)"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-gray-800/50 backdrop-blur-xl border border-gray-700/50 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-300 shadow-lg font-mono"
            />
          </div>

          {/* Save Button */}
          <div className="flex justify-end">
            <button
              disabled={saving}
              onClick={handleSave}
              className={`flex items-center gap-3 bg-gradient-to-r from-green-600 to-emerald-600 text-white px-8 py-4 rounded-xl font-semibold shadow-lg transform transition-all duration-300 ${
                saving
                  ? "opacity-50 cursor-not-allowed"
                  : "hover:from-green-700 hover:to-emerald-700 hover:shadow-xl hover:scale-105"
              }`}
            >
              <Save className="w-5 h-5" />
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
    </div>
  );
}
