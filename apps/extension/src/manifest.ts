import type { ManifestV3Export } from "@crxjs/vite-plugin";

const manifest: ManifestV3Export = {
  manifest_version: 3,
  name: "UplyFox",
  version: "0.2.0",
  description: "A resilient job-application copilot that detects, answers, fills, and always lets you copy.",
  icons: { "16": "icons/16.png", "32": "icons/32.png", "48": "icons/48.png", "128": "icons/128.png" },
  permissions: ["storage", "activeTab", "sidePanel", "alarms"],
  host_permissions: ["<all_urls>"],
  background: { service_worker: "src/background.ts", type: "module" },
  action: { default_title: "Open UplyFox", default_popup: "src/popup.html", default_icon: { "16": "icons/16.png", "32": "icons/32.png", "48": "icons/48.png", "128": "icons/128.png" } },
  side_panel: { default_path: "src/sidepanel.html" },
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content.ts"],
      run_at: "document_idle",
    },
  ],
};

export default manifest;
