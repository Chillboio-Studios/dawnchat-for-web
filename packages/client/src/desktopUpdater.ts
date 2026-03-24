import { captureClientError } from "./sentry";

const isDesktopRuntime =
  typeof window !== "undefined" &&
  ("__TAURI__" in window || "__TAURI_INTERNALS__" in window);

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

type UpdaterModule = {
  check: () => Promise<
    | null
    | {
        currentVersion: string;
        version: string;
        date?: string;
        body?: string;
        downloadAndInstall: (
          onEvent?: (event: {
            event: "Started" | "Progress" | "Finished";
            data?: {
              contentLength?: number;
              chunkLength?: number;
            };
          }) => void,
        ) => Promise<void>;
      }
  >;
};

type ProcessModule = {
  relaunch: () => Promise<void>;
};

async function checkAndUpdateDesktopApp() {
  if (!isDesktopRuntime) return;

  try {
    const [{ check }, { relaunch }] = await Promise.all([
      import("@tauri-apps/plugin-updater") as Promise<UpdaterModule>,
      import("@tauri-apps/plugin-process") as Promise<ProcessModule>,
    ]);

    const update = await check();
    if (!update) return;

    const autoInstall = window.confirm(
      `A DawnChat desktop update is available (${update.currentVersion} -> ${update.version}).\\n\\n` +
        "Download and install it now?",
    );

    if (!autoInstall) return;

    let downloaded = 0;
    let contentLength = 0;

    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case "Started":
          contentLength = event.data?.contentLength ?? 0;
          downloaded = 0;
          console.info("[updater] download started", {
            from: update.currentVersion,
            to: update.version,
            contentLength,
          });
          break;
        case "Progress": {
          const chunkLength = event.data?.chunkLength ?? 0;
          downloaded += chunkLength;
          const percent =
            contentLength > 0 ? Math.min(100, (downloaded / contentLength) * 100) : undefined;
          console.info("[updater] download progress", {
            downloaded,
            contentLength,
            percent,
          });
          break;
        }
        case "Finished":
          console.info("[updater] download finished", {
            to: update.version,
          });
          break;
      }
    });

    const restartNow = window.confirm(
      "Update installed successfully. DawnChat needs to restart to apply the update. Restart now?",
    );

    if (restartNow) {
      await relaunch();
    }
  } catch (error) {
    const result = captureClientError(error, "desktop.updater");
    console.error("[updater] failed", result.summary);
  }
}

export function initDesktopUpdater() {
  if (!isDesktopRuntime) return;

  void checkAndUpdateDesktopApp();

  window.setInterval(() => {
    void checkAndUpdateDesktopApp();
  }, UPDATE_CHECK_INTERVAL_MS);
}
