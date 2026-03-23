#!/usr/bin/env bash
set -euo pipefail

# Build and install DawnChat Flatpak from a source zip on the local machine.
# Usage:
#   bash packaging/flatpak/install-flatpak-from-zip.sh /path/to/otube-for-web.zip
#   bash packaging/flatpak/install-flatpak-from-zip.sh https://github.com/<org>/<repo>/archive/refs/heads/main.zip

ZIP_INPUT="${1:-}"

if [[ -z "${ZIP_INPUT}" ]]; then
  echo "Usage: $0 <zip-file-path-or-url>"
  exit 1
fi

need_cmd() {
  local cmd="$1"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "Missing required command: ${cmd}"
    exit 1
  fi
}

need_cmd flatpak
need_cmd flatpak-builder
need_cmd pnpm
need_cmd node
need_cmd unzip
need_cmd curl

if [[ "${ZIP_INPUT}" =~ ^https?:// ]]; then
  need_cmd mktemp
fi

if [[ "${ZIP_INPUT}" =~ ^https?:// ]]; then
  TMP_DIR="$(mktemp -d)"
  ZIP_FILE="${TMP_DIR}/repo.zip"
  echo "Downloading source archive..."
  curl -fsSL "${ZIP_INPUT}" -o "${ZIP_FILE}"
else
  ZIP_FILE="${ZIP_INPUT}"
  if [[ ! -f "${ZIP_FILE}" ]]; then
    echo "Zip archive not found: ${ZIP_FILE}"
    exit 1
  fi
  TMP_DIR="$(mktemp -d)"
fi

WORK_DIR="${TMP_DIR}/src"
mkdir -p "${WORK_DIR}"

echo "Extracting archive..."
unzip -q "${ZIP_FILE}" -d "${WORK_DIR}"

# Find extracted repo root (first directory containing package.json).
REPO_DIR="$(find "${WORK_DIR}" -mindepth 1 -maxdepth 2 -type f -name package.json -printf '%h\n' | head -n 1)"
if [[ -z "${REPO_DIR}" ]]; then
  echo "Could not locate extracted repository root."
  exit 1
fi

cd "${REPO_DIR}"

echo "Adding Flathub remote and installing runtime..."
flatpak remote-add --user --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
flatpak install --user -y flathub org.freedesktop.Platform//24.08 org.freedesktop.Sdk//24.08

echo "Installing JS dependencies..."
pnpm install --frozen-lockfile --prefer-offline

echo "Building workspace dependencies..."
pnpm --filter stoat.js build
pnpm --filter solid-livekit-components build
pnpm --filter @lingui-solid/babel-plugin-lingui-macro build
pnpm --filter @lingui-solid/babel-plugin-extract-messages build
pnpm --filter client exec lingui compile --typescript

echo "Building desktop binary..."
OTUBE_LINUX_FLAVOR=flatpak-local pnpm --filter client exec node ./scripts/build-desktop.mjs linux-nobundle

echo "Building Flatpak bundle..."
flatpak-builder --force-clean --repo=repo flatpak-build-dir packaging/flatpak/com.chillboiostudios.dawnchat.yml
flatpak build-bundle repo DawnChat-local.flatpak com.chillboiostudios.dawnchat

echo "Installing Flatpak bundle..."
flatpak install --user -y --reinstall DawnChat-local.flatpak

echo "Done. Launch with: flatpak run com.chillboiostudios.dawnchat"
