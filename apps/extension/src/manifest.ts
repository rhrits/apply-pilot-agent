import type { ManifestV3Export } from "@crxjs/vite-plugin";

const manifest: ManifestV3Export = {
  manifest_version: 3,
  name: "ApplyPilot",
  version: "0.2.0",
  description: "A resilient job-application copilot that detects, answers, fills, and always lets you copy.",
  permissions: ["storage", "activeTab", "sidePanel"],
  host_permissions: ["<all_urls>"],
  background: { service_worker: "src/background.ts", type: "module" },
  action: { default_title: "Open ApplyPilot", default_popup: "src/popup.html" },
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
