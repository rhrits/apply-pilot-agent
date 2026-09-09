import { getSupabaseBrowserClient } from "./supabase";

/**
 * Clears browser data owned by UplyFox on the current app origin only.
 * It cannot and must not clear cookies belonging to other websites.
 */
export async function clearUplyFoxBrowserData() {
  if (typeof window === "undefined") return;

  // This runs on the UplyFox origin only. It does not affect local data for
  // the job boards or any other website.
  window.localStorage.clear();
  window.sessionStorage.clear();

  if ("caches" in window) {
    const cacheNames = await window.caches.keys();
    await Promise.all(cacheNames.map((name) => window.caches.delete(name)));
  }

  if ("indexedDB" in window && typeof indexedDB.databases === "function") {
    const databases = await indexedDB.databases();
    await Promise.all(databases.map((database) => database.name ? new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(database.name!);
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    }) : Promise.resolve()));
  }

  // Supabase browser sessions are normally localStorage-backed, but remove any
  // accessible cookies on this app origin as a defensive cleanup step. HttpOnly
  // cookies are intentionally left to the server and cannot be read by JavaScript.
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax`;
  }
}

export async function signOutUplyFox(clearLocalData: boolean) {
  // The content script relays this same-origin signal to the extension service
  // worker, so a web logout also clears the paired extension session when present.
  window.postMessage({ source: "uplyfox-web", type: "UPLYFOX_LOGOUT", clearLocalData }, window.location.origin);
  const supabase = getSupabaseBrowserClient();
  await supabase?.auth.signOut();
  if (clearLocalData) await clearUplyFoxBrowserData();
}
