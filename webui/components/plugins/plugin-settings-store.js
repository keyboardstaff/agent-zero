import { createStore } from "/js/AlpineStore.js";

const fetchApi = globalThis.fetchApi;

const model = {
    // which plugin this modal is showing
    pluginName: null,
    pluginMeta: null,

    // context selectors (mirrors skills list pattern)
    projects: [],
    agentProfiles: [],
    projectName: "",
    agentProfileKey: "",

    // plugin settings data (plugins bind their fields here)
    settings: {},

    // where the settings were actually loaded from
    loadedPath: "",
    loadedProjectName: "",
    loadedAgentProfile: "",

    projectLabel(key) {
        if (!key) return "Global";
        const found = (this.projects || []).find((p) => p.key === key);
        return found?.label || key;
    },

    agentProfileLabel(key) {
        if (!key) return "All profiles";
        const found = (this.agentProfiles || []).find((p) => p.key === key);
        return found?.label || key;
    },

    get scopeMismatchMessage() {
        const selectedProject = this.projectName || "";
        const selectedProfile = this.agentProfileKey || "";
        const loadedProject = this.loadedProjectName || "";
        const loadedProfile = this.loadedAgentProfile || "";

        if (!this.loadedPath) return "";
        if (selectedProject === loadedProject && selectedProfile === loadedProfile) return "";

        return `Settings do not yet exist for this combination, settings from ${this.projectLabel(loadedProject)}, ${this.agentProfileLabel(loadedProfile)} (${this.loadedPath}) will apply.`;
    },

    configs: [],
    isListingConfigs: false,
    configsError: null,

    async openConfigListModal() {
        await window.openModal?.("/components/plugins/plugin-configs.html");
    },

    async loadConfigList() {
        if (!this.pluginName) return;
        this.isListingConfigs = true;
        this.configsError = null;
        try {
            // TODO: list existing plugin config scopes without API calls
            this.configs = [];
        } catch (e) {
            this.configsError = e?.message || "Failed to load configurations";
            this.configs = [];
        } finally {
            this.isListingConfigs = false;
        }
    },

    async switchToConfig(projectName, agentProfile) {
        this.projectName = projectName || "";
        this.agentProfileKey = agentProfile || "";
        await this.loadSettings();
        await window.closeModal?.();
    },

    async deleteConfig(projectName, agentProfile) {
        if (!this.pluginName) return;
        try {
            // TODO: delete existing plugin config scope without API calls
            this.configsError = "Delete is not implemented yet";
        } catch (e) {
            this.configsError = e?.message || "Delete failed";
        }
    },

    // 'plugin' = save to plugin settings API
    // 'core'   = save via $store.settings.saveSettings() (for plugins that surface core settings)
    saveMode: 'plugin',

    isLoading: false,
    isSaving: false,
    error: null,

    // Called by the subsection button before openModal()
    async open(pluginName) {
        this.pluginName = pluginName;
        this.pluginMeta = null;
        this.settings = {};
        this.error = null;
        this.saveMode = 'plugin';
        this.projectName = "";
        this.agentProfileKey = "";
        this.loadedPath = "";
        this.loadedProjectName = "";
        this.loadedAgentProfile = "";
        await Promise.all([this.loadProjects(), this.loadAgentProfiles()]);
        await this.loadSettings();
    },

    // Called by x-create inside the modal on every open
    async onModalOpen() {
        if (this.pluginName) await this.loadSettings();
    },

    async loadAgentProfiles() {
        try {
            const response = await fetchApi("/agents", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "list" }),
            });
            const data = await response.json().catch(() => ({}));
            this.agentProfiles = data.ok ? (data.data || []) : [];
        } catch {
            this.agentProfiles = [];
        }
    },

    async loadProjects() {
        try {
            const response = await fetchApi("/projects", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "list_options" }),
            });
            const data = await response.json().catch(() => ({}));
            this.projects = data.ok ? (data.data || []) : [];
        } catch {
            this.projects = [];
        }
    },

    async loadSettings() {
        if (!this.pluginName) return;
        this.isLoading = true;
        this.error = null;
        try {
            const response = await fetchApi("/plugins", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "get_config",
                    plugin_name: this.pluginName,
                    project_name: this.projectName || "",
                    agent_profile: this.agentProfileKey || "",
                }),
            });
            const result = await response.json().catch(() => ({}));
            this.settings = result.ok ? (result.data || {}) : {};
            this.loadedPath = result.loaded_path || "";
            this.loadedProjectName = result.loaded_project_name || "";
            this.loadedAgentProfile = result.loaded_agent_profile || "";
            if (!result.ok) this.error = result.error || "Failed to load settings";
        } catch (e) {
            this.error = e?.message || "Failed to load settings";
            this.settings = {};
        } finally {
            this.isLoading = false;
        }
    },

    async save() {
        if (!this.pluginName) return;

        // Core-backed plugins (e.g. memory) delegate to the settings store
        if (this.saveMode === 'core') {
            const coreStore = Alpine.store('settings');
            if (coreStore?.saveSettings) {
                const ok = await coreStore.saveSettings();
                if (ok) window.closeModal?.();
            }
            return;
        }

        // Plugin-specific settings: persist to plugin settings API
        this.isSaving = true;
        this.error = null;
        try {
            const response = await fetchApi("/plugins", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "save_config",
                    plugin_name: this.pluginName,
                    project_name: this.projectName || "",
                    agent_profile: this.agentProfileKey || "",
                    settings: this.settings,
                }),
            });
            const result = await response.json().catch(() => ({}));
            if (!result.ok) this.error = result.error || "Save failed";
            else window.closeModal?.();
        } catch (e) {
            this.error = e?.message || "Save failed";
        } finally {
            this.isSaving = false;
        }
    },

    cleanup() {
        this.pluginName = null;
        this.pluginMeta = null;
        this.settings = {};
        this.loadedPath = "";
        this.loadedProjectName = "";
        this.loadedAgentProfile = "";
        this.error = null;
    },

    // Reactive URL for the plugin's settings component (used with x-html injection)
    get settingsComponentHtml() {
        if (!this.pluginName) return "";
        return `<x-component path="/plugins/${this.pluginName}/webui/config.html"></x-component>`;
    },
};

export const store = createStore("pluginSettings", model);
