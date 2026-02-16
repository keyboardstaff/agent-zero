import * as api from "./api.js";

// Load all x-component tags starting from root elements
export async function loadExtensions(roots = [document.documentElement]) {
  try {
    // Convert single root to array if needed
    const rootElements = Array.isArray(roots) ? roots : [roots];

    // Find all top-level components and load them in parallel
    const extensions = rootElements.flatMap((root) =>
      Array.from(root.querySelectorAll("x-extension")),
    );

    if (extensions.length === 0) return;

    await Promise.all(
      extensions.map(async (extension) => {
        const path = extension.getAttribute("id");
        if (!path) {
          console.error("x-extension missing id attribute:", extension);
          return;
        }
        await importExtensions(path, extension);
      }),
    );
  } catch (error) {
    console.error("Error loading extensions:", error);
  }
}

// import all extensions for extension point via backend api
export async function importExtensions(extensionPointId, targetElement) {
  try {
    const response = await api.callJsonApi(`/api/load_webui_extensions`, {
      extension_point: extensionPointId,
    });
    let combinedHTML = "";
    for (const extension of response.extensions) {
      combinedHTML += extension.html.trim();
    }
    targetElement.innerHTML = combinedHTML;
  } catch (error) {
    console.error("Error importing extensions:", error);
  }
}

// Watch for DOM changes to dynamically load x-extensions
const extensionObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType === 1) {
        // ELEMENT_NODE
        // Check if this node or its descendants contain x-extension(s)
        if (node.matches?.("x-extension")) {
          importExtensions(node.getAttribute("id"), node);
        } else if (node.querySelectorAll) {
          loadExtensions([node]);
        }
      }
    }
  }
});
extensionObserver.observe(document.body, { childList: true, subtree: true });
