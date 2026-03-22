/* eslint-env node */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(clientRoot, "..", "..");

const target = process.argv[2];
if (!["linux", "linux-nobundle", "windows"].includes(target)) {
  console.error(
    "Usage: node scripts/build-desktop.mjs <linux|linux-nobundle|windows>",
  );
  process.exit(1);
}

const envFile =
  process.env.OTUBE_ENV_FILE || path.join(repoRoot, ".env.client");
const parsed = dotenv.parse(readFileSync(envFile, "utf8"));

const appApiUrl = (parsed.APP_API_URL || "").trim();
const clientApiUrl = (parsed.APP_CLIENT_API_URL || "").trim();

if (!appApiUrl || !clientApiUrl) {
  console.error(
    "Missing APP_API_URL or APP_CLIENT_API_URL in .env.client (or OTUBE_ENV_FILE).",
  );
  process.exit(1);
}

const normalizedApiUrl = appApiUrl.replace(/\/+$/, "");
const normalizedClientApiUrl = clientApiUrl.replace(/\/+$/, "");
const apiUrl = new URL(normalizedApiUrl);

const wsProtocol = apiUrl.protocol === "https:" ? "wss:" : "ws:";
const wsPath = apiUrl.pathname.endsWith("/api")
  ? `${apiUrl.pathname.slice(0, -4)}/ws`
  : "/ws";
const derivedWsUrl = `${wsProtocol}//${apiUrl.host}${wsPath}`;

const mediaUrl = `${apiUrl.protocol}//${apiUrl.host}/autumn`;
const proxyUrl = `${apiUrl.protocol}//${apiUrl.host}/january`;

const env = {
  ...process.env,
  VITE_API_URL: normalizedApiUrl,
  VITE_CLIENT_API_URL: normalizedClientApiUrl,
  VITE_WS_URL: derivedWsUrl,
  VITE_MEDIA_URL: mediaUrl,
  VITE_PROXY_URL: proxyUrl,
  VITE_DESKTOP_LINUX_FLAVOR: "",
};

if (target.startsWith("linux")) {
  const explicitFlavor = process.env.OTUBE_LINUX_FLAVOR?.trim();

  if (explicitFlavor) {
    env.VITE_DESKTOP_LINUX_FLAVOR = explicitFlavor;
  } else {
    const osReleasePath = "/etc/os-release";
    if (existsSync(osReleasePath)) {
      const osRelease = readFileSync(osReleasePath, "utf8");
      const id = osRelease
        .split("\n")
        .find((line) => line.startsWith("ID="))
        ?.slice(3)
        ?.replace(/^"|"$/g, "")
        ?.trim();

      env.VITE_DESKTOP_LINUX_FLAVOR = id || "distro";
    } else {
      env.VITE_DESKTOP_LINUX_FLAVOR = "distro";
    }
  }
}

const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: clientRoot,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

run("pnpm", ["exec", "vite", "build"]);

if (target === "linux") {
  run("pnpm", ["exec", "tauri", "build", "--bundles", "deb,appimage,rpm"]);
} else if (target === "linux-nobundle") {
  run("pnpm", ["exec", "tauri", "build", "--no-bundle"]);
} else {
  run("pnpm", ["exec", "tauri", "build", "--bundles", "msi,nsis"]);
}
