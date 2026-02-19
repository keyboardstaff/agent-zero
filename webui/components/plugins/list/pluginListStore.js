import { createStore } from "/js/AlpineStore.js";
import * as api from "/js/api.js";
import {
  store as notificationStore,
  defaultPriority,
} from "/components/notifications/notification-store.js";

// define the model object holding data and functions
const model = {
  loading: false,
  plugins: [],

  async loadPluginList(filter) {
    this.loading = true;
    this.plugins = [];
    try {
      const response = await api.callJsonApi("plugins_list", { filter });
      this.plugins = response.plugins;
    } catch (e) {
      showErrorNotification(e, "Failed to load plugins list");
    } finally {
      this.loading = false;
    }
  },
};

function showErrorNotification(error, heading) {
    const text = error.message || error.text || JSON.stringify(error);
  notificationStore.frontendError(
    text,
    heading,
    3,
    "pluginsList",
    defaultPriority,
    true,
  );
}

// convert it to alpine store
const store = createStore("pluginListStore", model);

// export for use in other files
export { store };
