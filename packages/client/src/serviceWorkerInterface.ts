import { createSignal } from "solid-js";

import { registerSW } from "virtual:pwa-register";

const [pendingUpdate, setPendingUpdate] = createSignal<() => void>();

export { pendingUpdate };

const isDesktopRuntime =
  typeof window !== "undefined" &&
  ("__TAURI__" in window ||
    "__TAURI_INTERNALS__" in window ||
    window.location.hostname === "tauri.localhost" ||
    window.location.hostname.endsWith(".tauri.localhost") ||
    window.location.protocol === "tauri:");

if (import.meta.env.PROD && !isDesktopRuntime && "serviceWorker" in navigator) {
  try {
    const updateSW = registerSW({
      onNeedRefresh() {
        setPendingUpdate(() => void updateSW(true));
      },
      onOfflineReady() {
        console.info("Ready to work offline =)");
        // toast to users
      },
      onRegistered(r) {
        if (!r) return;

        // Check for updates every hour
        setInterval(() => {
          void r.update();
        }, 36e5);
      },
      onRegisterError(error) {
        console.warn("Service worker registration failed", error);
      },
    });
  } catch (error) {
    console.warn("Service worker setup failed", error);
  }
}
