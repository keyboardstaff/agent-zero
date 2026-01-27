import { createStore } from "/js/AlpineStore.js";

const STORAGE_KEY_GROUPS = "chatGroups";
const STORAGE_KEY_MAP = "chatGroupMap";

const model = {
  groups: [],
  selectedGroupId: null,
  chatGroupMap: {},
  isPanelOpen: false,

  // Drag state for group reordering
  dragType: null,
  dragIndex: null,

  // Preset groups with fixed icons
  presetGroups: [
    { name: "Homework", icon: "school" },
    { name: "Writing", icon: "edit_note" },
    { name: "Investing", icon: "trending_up" },
    { name: "Health", icon: "favorite" },
    { name: "Travel", icon: "flight" }
  ],

  // Available icons for custom groups
  availableIcons: [
    "folder", "star", "bookmark", "work", "home", "code", "science",
    "psychology", "lightbulb", "music_note", "sports_esports", "shopping_cart",
    "restaurant", "fitness_center", "pets", "eco", "palette", "camera_alt"
  ],

  // Form state for creating groups
  formName: "",
  formIcon: "folder",

  init() {
    this.loadFromStorage();
  },

  // Load groups and map from localStorage
  loadFromStorage() {
    try {
      const groupsData = localStorage.getItem(STORAGE_KEY_GROUPS);
      const mapData = localStorage.getItem(STORAGE_KEY_MAP);
      
      if (groupsData) {
        this.groups = JSON.parse(groupsData);
      }
      if (mapData) {
        this.chatGroupMap = JSON.parse(mapData);
      }
    } catch (e) {
      console.error("Failed to load groups from storage", e);
    }
  },

  // Persist groups to localStorage
  persistGroups() {
    try {
      localStorage.setItem(STORAGE_KEY_GROUPS, JSON.stringify(this.groups));
    } catch (e) {
      console.error("Failed to persist groups", e);
    }
  },

  // Persist chat-group map to localStorage
  persistMap() {
    try {
      localStorage.setItem(STORAGE_KEY_MAP, JSON.stringify(this.chatGroupMap));
    } catch (e) {
      console.error("Failed to persist chat group map", e);
    }
  },

  // Open create panel
  openCreatePanel() {
    this.formName = "";
    this.formIcon = "folder";
    this.isPanelOpen = true;
  },

  // Close panel
  closePanel() {
    this.isPanelOpen = false;
    this.formName = "";
    this.formIcon = "folder";
  },

  // Select a preset group (auto-fill form)
  selectPreset(preset) {
    this.formName = preset.name;
    this.formIcon = preset.icon;
  },

  // Create a new group
  createGroup() {
    if (!this.formName.trim()) return;

    const newGroup = {
      id: Date.now().toString(),
      name: this.formName.trim(),
      icon: this.formIcon,
      order: this.groups.length
    };

    this.groups = [...this.groups, newGroup];
    this.persistGroups();
    this.closePanel();
  },

  // Delete a group
  deleteGroup(groupId) {
    this.groups = this.groups.filter(g => g.id !== groupId);
    
    // Remove chats from this group
    const newMap = { ...this.chatGroupMap };
    for (const chatId in newMap) {
      if (newMap[chatId] === groupId) {
        delete newMap[chatId];
      }
    }
    this.chatGroupMap = newMap;
    
    // Clear selection if deleted group was selected
    if (this.selectedGroupId === groupId) {
      this.selectedGroupId = null;
    }
    
    this.persistGroups();
    this.persistMap();
  },

  // Select/deselect a group for filtering
  toggleGroupSelection(groupId) {
    if (this.selectedGroupId === groupId) {
      this.selectedGroupId = null;
    } else {
      this.selectedGroupId = groupId;
    }
  },

  // Assign a chat to a group
  assignChatToGroup(chatId, groupId) {
    if (!chatId || !groupId) return;
    
    this.chatGroupMap = {
      ...this.chatGroupMap,
      [chatId]: groupId
    };
    this.persistMap();
  },

  // Remove a chat from its group
  removeChatFromGroup(chatId) {
    if (!chatId || !this.chatGroupMap[chatId]) return;
    
    const newMap = { ...this.chatGroupMap };
    delete newMap[chatId];
    this.chatGroupMap = newMap;
    this.persistMap();
  },

  // Get the group ID for a chat
  getChatGroupId(chatId) {
    return this.chatGroupMap[chatId] || null;
  },

  // Get group by ID
  getGroupById(groupId) {
    return this.groups.find(g => g.id === groupId);
  },

  // Reorder groups (for drag & drop)
  reorderGroups(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    
    const newGroups = [...this.groups];
    const [moved] = newGroups.splice(fromIndex, 1);
    newGroups.splice(toIndex, 0, moved);
    
    // Update order property
    newGroups.forEach((g, i) => g.order = i);
    
    this.groups = newGroups;
    this.persistGroups();
  },

  // Check if a chat belongs to the currently selected group
  isChatInSelectedGroup(chatId) {
    if (!this.selectedGroupId) return true; // No filter, show all
    return this.chatGroupMap[chatId] === this.selectedGroupId;
  }
};

export const store = createStore("groups", model);
