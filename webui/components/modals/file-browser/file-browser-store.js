import { createStore } from "/js/AlpineStore.js";
import { fetchApi, callJsonApi } from "/js/api.js";

// ACE mode mappings
const EXT_TO_MODE = {
  js: "javascript", mjs: "javascript", ts: "typescript", json: "json",
  html: "html", htm: "html", css: "css", py: "python", java: "java",
  c: "c_cpp", cpp: "c_cpp", h: "c_cpp", md: "markdown", yaml: "yaml",
  yml: "yaml", xml: "xml", sh: "sh", bash: "sh", sql: "sql", php: "php",
  rb: "ruby", go: "golang", rs: "rust",
};

// Model migrated from legacy file_browser.js (lift-and-shift)
const model = {
  // Reactive state
  isLoading: false,
  browser: {
    title: "File Browser",
    currentPath: "",
    entries: [],
    parentPath: "",
    sortBy: "name",
    sortDirection: "asc",
  },
  history: [], // navigation stack
  initialPath: "", // Store path for open() call
  closePromise: null,
  error: null,

  // --- Lifecycle -----------------------------------------------------------
  init() {
    // Nothing special to do here; all methods available immediately
  },

  // --- Public API (called from button/link) --------------------------------
  async open(path = "") {
    if (this.isLoading) return; // Prevent double-open
    this.isLoading = true;
    this.error = null;
    this.history = [];

    try {
      // Open modal FIRST (immediate UI feedback)
      this.closePromise = window.openModal(
        "modals/file-browser/file-browser.html"
      );

      // // Setup cleanup on modal close
      // if (this.closePromise && typeof this.closePromise.then === "function") {
      //   this.closePromise.then(() => {
      //     this.destroy();
      //   });
      // }
      
      // Use stored initial path or default
      path = path || this.initialPath || this.browser.currentPath || "$WORK_DIR";
      this.browser.currentPath = path;

      // Fetch files
      await this.fetchFiles(this.browser.currentPath);

      // await modal close
      await this.closePromise;
      this.destroy();

    } catch (error) {
      console.error("File browser error:", error);
      this.error = error?.message || "Failed to load files";
      this.isLoading = false;
    }
  },

  handleClose() {
    // Close the modal manually
    window.closeModal();
  },

  destroy() {
    // Reset state when modal closes
    this.isLoading = false;
    this.history = [];
    this.initialPath = "";
    this.browser.entries = [];
  },

  // --- Helpers -------------------------------------------------------------
  isArchive(filename) {
    const archiveExts = ["zip", "tar", "gz", "rar", "7z"];
    const ext = filename.split(".").pop().toLowerCase();
    return archiveExts.includes(ext);
  },

  formatFileSize(size) {
    if (size === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(size) / Math.log(k));
    return parseFloat((size / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  },

  formatDate(dateString) {
    const options = {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    };
    return new Date(dateString).toLocaleDateString(undefined, options);
  },

  // --- Sorting -------------------------------------------------------------
  toggleSort(column) {
    if (this.browser.sortBy === column) {
      this.browser.sortDirection =
        this.browser.sortDirection === "asc" ? "desc" : "asc";
    } else {
      this.browser.sortBy = column;
      this.browser.sortDirection = "asc";
    }
  },

  sortFiles(entries) {
    return [...entries].sort((a, b) => {
      // Folders first
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
      const dir = this.browser.sortDirection === "asc" ? 1 : -1;
      switch (this.browser.sortBy) {
        case "name":
          return dir * a.name.localeCompare(b.name);
        case "size":
          return dir * (a.size - b.size);
        case "date":
          return dir * (new Date(a.modified) - new Date(b.modified));
        default:
          return 0;
      }
    });
  },

  // --- Navigation ----------------------------------------------------------
  async fetchFiles(path = "") {
    this.isLoading = true;
    try {
      const response = await fetchApi(
        `/get_work_dir_files?path=${encodeURIComponent(path)}`
      );
      if (response.ok) {
        const data = await response.json();
        this.browser.entries = data.data.entries;
        this.browser.currentPath = data.data.current_path;
        this.browser.parentPath = data.data.parent_path;
      } else {
        console.error("Error fetching files:", await response.text());
        this.browser.entries = [];
      }
    } catch (e) {
      window.toastFrontendError(
        "Error fetching files: " + e.message,
        "File Browser Error"
      );
      this.browser.entries = [];
    } finally {
      this.isLoading = false;
    }
  },

  async navigateToFolder(path) {
    if(!path.startsWith("/")) path = "/" + path;
    if (this.browser.currentPath !== path)
      this.history.push(this.browser.currentPath);
    await this.fetchFiles(path);
  },

  async navigateUp() {
    if (this.browser.parentPath) {
      this.history.push(this.browser.currentPath);
      await this.fetchFiles(this.browser.parentPath);
    }
  },

  // --- File actions --------------------------------------------------------
  async deleteFile(file) {
    try {
      const resp = await fetchApi("/delete_work_dir_file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: file.path,
          currentPath: this.browser.currentPath,
        }),
      });
      if (resp.ok) {
        this.browser.entries = this.browser.entries.filter(
          (e) => e.path !== file.path
        );
        const itemType = file.is_dir ? "Folder" : "File";
        window.toastFrontendSuccess(`${itemType} "${file.name}" deleted successfully`, `${itemType} Deleted`);
      } else {
        const itemType = file.is_dir ? "folder" : "file";
        window.toastFrontendError(`Error deleting ${itemType}: ${await resp.text()}`, "Delete Error");
      }
    } catch (e) {
      const itemType = file.is_dir ? "folder" : "file";
      window.toastFrontendError(
        `Error deleting ${itemType}: ` + e.message,
        "Delete Error"
      );
    }
  },

  async handleFileUpload(event) {
    return store._handleFileUpload(event); // bind to model to ensure correct context
  },

  async _handleFileUpload(event) {
    try {
      const files = event.target.files;
      if (!files.length) return;
      const formData = new FormData();
      formData.append("path", this.browser.currentPath);
      for (let f of files) {
        const ext = f.name.split(".").pop().toLowerCase();
        if (
          !["zip", "tar", "gz", "rar", "7z"].includes(ext) &&
          f.size > 100 * 1024 * 1024
        ) {
          alert(`File ${f.name} exceeds 100MB limit.`);
          continue;
        }
        formData.append("files[]", f);
      }
      const resp = await fetchApi("/upload_work_dir_files", {
        method: "POST",
        body: formData,
      });
      if (resp.ok) {
        const data = await resp.json();
        this.browser.entries = data.data.entries;
        this.browser.currentPath = data.data.current_path;
        this.browser.parentPath = data.data.parent_path;
        if (data.failed && data.failed.length) {
          const msg = data.failed
            .map((f) => `${f.name}: ${f.error}`)
            .join("\n");
          alert(`Some files failed to upload:\n${msg}`);
        }
      } else {
        alert(await resp.text());
      }
    } catch (e) {
      window.toastFrontendError(
        "Error uploading files: " + e.message,
        "File Upload Error"
      );
    } finally {
      event.target.value = ""; // reset input so same file can be reselected
    }
  },

  downloadFile(file) {
    const link = document.createElement("a");
    link.href = `/download_work_dir_file?path=${encodeURIComponent(file.path)}`;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  },

  // --- Rename / Edit / New File / New Folder -------------------------------
  // Shared state for edit/rename modals
  edit: { isLoading: false, isSaving: false, filePath: "", fileName: "", originalFileName: "", content: "", originalContent: "", isNewFile: false, editor: null },
  rename: { isLoading: false, currentName: "", newName: "", filePath: "", isDir: false, isNewFolder: false },

  openRename(file) {
    Object.assign(this.rename, { isLoading: false, currentName: file.name, newName: file.name, filePath: file.path, isDir: file.is_dir, isNewFolder: false });
    window.openModal("modals/file-browser/file-rename.html");
    this.updateRenameTitle();
  },

  openNewFolder() {
    Object.assign(this.rename, { isLoading: false, currentName: "", newName: "", filePath: "", isDir: true, isNewFolder: true });
    window.openModal("modals/file-browser/file-rename.html");
    this.updateRenameTitle();
  },

  updateRenameTitle() {
    requestAnimationFrame(() => {
      const title = [...document.querySelectorAll(".modal.show .modal-title")].pop();
      if (title) title.textContent = this.rename.isNewFolder ? "New Folder" : "Rename";
    });
  },

  async submitRename() {
    const name = this.rename.newName.trim();
    if (!name || name.includes("/") || name.includes("\\")) {
      window.toastFrontendError(name ? "Invalid name" : "Name required", "Error");
      return;
    }
    this.rename.isLoading = true;
    try {
      if (this.rename.isNewFolder) {
        const folderPath = this.browser.currentPath ? `${this.browser.currentPath}/${name}/.keep` : `${name}/.keep`;
        await callJsonApi("/save_work_dir_file", { path: folderPath, content: "", createNew: true });
        window.toastFrontendSuccess(`Folder "${name}" created successfully`, "Folder Created");
      } else {
        await callJsonApi("/rename_work_dir_file", { oldPath: this.rename.filePath, newName: name });
        window.toastFrontendSuccess(`Renamed to "${name}" successfully`, "Renamed");
      }
      await this.fetchFiles(this.browser.currentPath);
      window.closeModal();
    } catch (e) {
      const itemType = this.rename.isNewFolder ? "folder" : "item";
      const msg = e.message?.toLowerCase() || "";
      if (msg.includes("exists") || msg.includes("already")) {
        window.toastFrontendError(`A ${itemType} with this name already exists`, "Name Conflict");
      } else {
        window.toastFrontendError(e.message || "Failed", "Error");
      }
    } finally {
      this.rename.isLoading = false;
    }
  },

  async openEdit(file) {
    Object.assign(this.edit, { isLoading: true, isSaving: false, filePath: file.path, fileName: "", originalFileName: "", content: "", originalContent: "", isNewFile: false, editor: null });
    window.openModal("modals/file-browser/file-edit.html", { beforeClose: () => this.checkEditChanges() });
    try {
      const result = await callJsonApi("/read_work_dir_file", { path: file.path });
      Object.assign(this.edit, { content: result.content, originalContent: result.content, fileName: result.fileName, originalFileName: result.fileName, isLoading: false });
      this.updateEditTitle();
      this.scheduleEditorInit();
    } catch (e) {
      window.toastFrontendError(e.message || "Load failed", "Error");
      this.edit.isLoading = false;
    }
  },

  openNewFile() {
    Object.assign(this.edit, { isLoading: false, isSaving: false, filePath: "", fileName: "", originalFileName: "", content: "", originalContent: "", isNewFile: true, editor: null });
    window.openModal("modals/file-browser/file-edit.html", { beforeClose: () => this.checkEditChanges() });
    this.updateEditTitle();
    this.scheduleEditorInit();
  },

  updateEditTitle() {
    requestAnimationFrame(() => {
      const title = [...document.querySelectorAll(".modal.show .modal-title")].pop();
      if (title) title.textContent = this.edit.isNewFile ? "New File" : "Edit File";
    });
  },

  checkEditChanges() {
    const contentChanged = this.edit.content !== this.edit.originalContent;
    const nameChanged = !this.edit.isNewFile && this.edit.fileName !== this.edit.originalFileName;
    const newFileHasContent = this.edit.isNewFile && (this.edit.content || this.edit.fileName.trim());
    const changed = contentChanged || nameChanged || newFileHasContent;
    if (!changed) {
      // No changes, clean up and allow close
      this.cleanupEditor();
      return true;
    }
    return this.showConfirmDialog("Unsaved Changes", "Discard unsaved changes?").then(result => {
      if (result) {
        // User chose to discard - clean up editor
        this.cleanupEditor();
      } else {
        // User chose to continue editing - refresh the editor
        this.refreshEditor();
      }
      return result;
    });
  },

  refreshEditor() {
    if (!this.edit.editor) return;
    this.edit.editor.resize(true);
    this.edit.editor.renderer.updateFull(true);
    this.edit.editor.focus();
  },

  // Show confirm dialog using template from file-browser.html
  showConfirmDialog(title, message, confirmText = "Discard") {
    return new Promise((resolve) => {
      const template = document.getElementById("confirm-dialog-template");
      if (!template) return resolve(true); // Fallback if template missing
      
      const overlay = template.content.cloneNode(true).firstElementChild;
      overlay.querySelector(".confirm-dialog-title").textContent = title;
      overlay.querySelector(".confirm-dialog-message").textContent = message;
      overlay.querySelector(".confirm-btn-ok").textContent = confirmText;
      document.body.appendChild(overlay);
      
      const cleanup = (result) => { overlay.remove(); resolve(result); };
      
      overlay.querySelector(".confirm-btn-cancel").onclick = () => cleanup(false);
      overlay.querySelector(".confirm-btn-ok").onclick = () => cleanup(true);
      overlay.addEventListener("click", (e) => { if (e.target === overlay) cleanup(false); });
      
      requestAnimationFrame(() => overlay.querySelector(".confirm-btn-cancel")?.focus());
    });
  },

  scheduleEditorInit() {
    // Use double requestAnimationFrame to ensure DOM is ready
    requestAnimationFrame(() => {
      requestAnimationFrame(() => this.initEditor());
    });
  },

  initEditor() {
    const container = document.getElementById("file-editor-container");
    if (!container || !window.ace?.edit) return;

    if (this.edit.editor?.destroy) this.edit.editor.destroy();

    this.edit.editor = window.ace.edit("file-editor-container");
    
    // Configure theme based on dark mode
    const darkMode = window.localStorage?.getItem("darkMode");
    this.edit.editor.setTheme(darkMode !== "false" ? "ace/theme/github_dark" : "ace/theme/tomorrow");
    
    // Set mode and options
    this.edit.editor.session.setMode(`ace/mode/${this.getAceMode()}`);
    this.edit.editor.setShowPrintMargin(false);
    this.edit.editor.setOptions({ fontSize: "14px", showGutter: true, highlightActiveLine: true, wrap: true });
    
    this.edit.editor.setValue(this.edit.content, -1);
    this.edit.editor.setReadOnly(false);
    this.edit.editor.clearSelection();
    this.edit.editor.focus();
    
    // Watch for content changes
    this.edit.editor.session.on("change", () => { this.edit.content = this.edit.editor.getValue(); });
    
    // Force resize after DOM settles
    setTimeout(() => this.edit.editor?.resize(true), 100);
  },

  getAceMode() {
    const ext = this.edit.fileName.split(".").pop()?.toLowerCase();
    return EXT_TO_MODE[ext] || "text";
  },

  updateEditorMode() {
    if (this.edit.editor) {
      this.edit.editor.session.setMode(`ace/mode/${this.getAceMode()}`);
    }
  },

  async saveEdit() {
    const newFileName = this.edit.fileName.trim();
    if (!newFileName) {
      window.toastFrontendError("Enter file name", "Error");
      return;
    }
    this.edit.isSaving = true;
    try {
      // Check if filename changed (for existing files)
      const fileNameChanged = !this.edit.isNewFile && newFileName !== this.edit.originalFileName;
      
      if (this.edit.isNewFile) {
        // New file: save to new path
        const path = this.browser.currentPath ? `${this.browser.currentPath}/${newFileName}` : newFileName;
        await callJsonApi("/save_work_dir_file", { path, content: this.edit.content, createNew: true });
        Object.assign(this.edit, { originalContent: this.edit.content, originalFileName: newFileName, isNewFile: false, filePath: path });
        window.toastFrontendSuccess(`File "${newFileName}" created successfully`, "File Created");
        await this.fetchFiles(this.browser.currentPath);
        this.cleanupEditor();
        window.closeModal();
      } else if (fileNameChanged) {
        // Existing file with name change: rename first, then save content
        await callJsonApi("/rename_work_dir_file", { oldPath: this.edit.filePath, newName: newFileName });
        // Update path after rename
        const pathParts = this.edit.filePath.split("/");
        pathParts[pathParts.length - 1] = newFileName;
        const newPath = pathParts.join("/");
        // Save content to new path
        await callJsonApi("/save_work_dir_file", { path: newPath, content: this.edit.content, createNew: false });
        Object.assign(this.edit, { originalContent: this.edit.content, originalFileName: newFileName, filePath: newPath });
        window.toastFrontendSuccess("Saved", "Success");
        await this.fetchFiles(this.browser.currentPath);
      } else {
        // Existing file, no name change: just save content
        await callJsonApi("/save_work_dir_file", { path: this.edit.filePath, content: this.edit.content, createNew: false });
        Object.assign(this.edit, { originalContent: this.edit.content });
        window.toastFrontendSuccess("Saved", "Success");
        await this.fetchFiles(this.browser.currentPath);
      }
    } catch (e) {
      const msg = e.message?.toLowerCase() || "";
      if (msg.includes("exists") || msg.includes("already")) {
        window.toastFrontendError("A file with this name already exists", "File Name Conflict");
      } else {
        window.toastFrontendError(e.message || "Save failed", "Error");
      }
    } finally {
      this.edit.isSaving = false;
    }
  },

  cancelEdit() {
    // Don't destroy editor here - let beforeClose handle confirmation first
    // Editor will be cleaned up when modal actually closes
    window.closeModal();
  },

  // Called when edit modal is actually closing (after beforeClose confirms)
  cleanupEditor() {
    if (this.edit.editor?.destroy) {
      this.edit.editor.destroy();
    }
    this.edit.editor = null;
  },

  cancelRename() {
    window.closeModal();
  },
};

export const store = createStore("fileBrowser", model);

window.openFileLink = async function (path) {
  try {
    const resp = await window.sendJsonData("/file_info", { path });
    if (!resp.exists) {
      window.toastFrontendError("File does not exist.", "File Error");
      return;
    }
    if (resp.is_dir) {
      // Set initial path and open via store
      await store.open(resp.abs_path);
    } else {
      store.downloadFile({ path: resp.abs_path, name: resp.file_name });
    }
  } catch (e) {
    window.toastFrontendError(
      "Error opening file: " + e.message,
      "File Open Error"
    );
  }
};
