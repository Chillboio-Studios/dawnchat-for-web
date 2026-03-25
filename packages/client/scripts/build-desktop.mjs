/* eslint-env node */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(clientRoot, "..", "..");

const target = process.argv[2];
if (!["linux", "linux-updater", "linux-nobundle", "windows"].includes(target)) {
  console.error(
    "Usage: node scripts/build-desktop.mjs <linux|linux-updater|linux-nobundle|windows>",
  );
  process.exit(1);
}

const envFile =
  process.env.OTUBE_ENV_FILE || path.join(repoRoot, ".env.client");
const parsed = existsSync(envFile)
  ? dotenv.parse(readFileSync(envFile, "utf8"))
  : {};

const appApiUrl = (
  process.env.APP_API_URL ||
  parsed.APP_API_URL ||
  "http://localhost:3000/api"
).trim();
const clientApiUrl = (
  process.env.APP_CLIENT_API_URL ||
  parsed.APP_CLIENT_API_URL ||
  "http://localhost:3000"
).trim();

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

function normalizeWindowsBundleVersion(version) {
  const match = /^(\d+\.\d+\.\d+)(?:-([^+]+))?(?:\+(.+))?$/.exec(version);
  if (!match) return version;

  const core = match[1];
  const prerelease = match[2];
  const metadata = match[3];

  if (!prerelease) return version;

  // MSI requires numeric-only prerelease <= 65535.
  const numeric = Number.parseInt(prerelease, 10);
  const isNumericOnly = /^[0-9]+$/.test(prerelease);
  if (isNumericOnly && Number.isFinite(numeric) && numeric >= 0 && numeric <= 65535) {
    return version;
  }

  const fallback = process.env.OTUBE_WINDOWS_PRERELEASE_ID ?? "1";
  const parsedFallback = Number.parseInt(fallback, 10);
  const safeId =
    Number.isFinite(parsedFallback) && parsedFallback >= 0 && parsedFallback <= 65535
      ? parsedFallback
      : 1;

  const normalizedTag = prerelease
    .replace(/[^0-9A-Za-z.-]+/g, ".")
    .replace(/\.+/g, ".")
    .replace(/^\.|\.$/g, "")
    .toLowerCase();

  const metadataParts = [];
  if (metadata) metadataParts.push(metadata);
  if (normalizedTag) metadataParts.push(`channel.${normalizedTag}`);

  return `${core}-${safeId}${metadataParts.length ? `+${metadataParts.join(".")}` : ""}`;
}

function rewriteVersionInJson(filePath, nextVersion) {
  const raw = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (typeof parsed.version !== "string") {
    throw new Error(`Missing string version field in ${filePath}`);
  }

  parsed.version = nextVersion;
  writeFileSync(filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

function rewriteVersionInCargoToml(filePath, nextVersion) {
  const raw = readFileSync(filePath, "utf8");
  const updated = raw.replace(
    /^(version\s*=\s*")[^"]+("\s*)$/m,
    `$1${nextVersion}$2`,
  );

  if (updated === raw) {
    throw new Error(`Could not update version in ${filePath}`);
  }

  writeFileSync(filePath, updated, "utf8");
}

function ensureWindowsCompatibleVersion() {
  const packageJsonPath = path.join(clientRoot, "package.json");
  const tauriConfigPath = path.join(clientRoot, "src-tauri", "tauri.conf.json");
  const cargoTomlPath = path.join(clientRoot, "src-tauri", "Cargo.toml");

  const packageVersion = JSON.parse(readFileSync(packageJsonPath, "utf8")).version;
  if (typeof packageVersion !== "string") {
    throw new Error("Missing version in client package.json");
  }

  const normalizedVersion = normalizeWindowsBundleVersion(packageVersion);
  if (normalizedVersion === packageVersion) {
    return;
  }

  console.info(
    `[windows-bundle] Normalizing version ${packageVersion} -> ${normalizedVersion} for MSI compatibility`,
  );

  rewriteVersionInJson(packageJsonPath, normalizedVersion);
  rewriteVersionInJson(tauriConfigPath, normalizedVersion);
  rewriteVersionInCargoToml(cargoTomlPath, normalizedVersion);
}

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
} else if (target === "linux-updater") {
  run("pnpm", ["exec", "tauri", "build", "--bundles", "deb,appimage"]);
} else if (target === "linux-nobundle") {
  run("pnpm", ["exec", "tauri", "build", "--no-bundle"]);
} else {
  ensureWindowsCompatibleVersion();
  run("pnpm", ["exec", "tauri", "build", "--bundles", "msi,nsis"]);
}
