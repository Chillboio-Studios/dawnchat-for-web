#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 3 ] || [ "$#" -gt 4 ]; then
  echo "Usage: $0 <major> <minor> <patch> [build]"
  echo "Example: $0 1 2 3"
  echo "Example: $0 1 2 3 nightly"
  echo "Example: $0 1 2 3 pre-release"
  exit 1
fi

major="$1"
minor="$2"
patch="$3"
build="${4:-}"

for part in "$major" "$minor" "$patch"; do
  if ! [[ "$part" =~ ^[0-9]+$ ]]; then
    echo "All version parts must be non-negative integers." >&2
    exit 1
  fi
done

version="${major}.${minor}.${patch}"

if [ -n "$build" ]; then
  case "$build" in
    nightly|beta|pre-release) ;;
    *)
      echo "Build must be one of: 'nightly', 'beta', 'pre-release'." >&2
      exit 1
      ;;
  esac

  # MSI requires numeric prerelease identifiers; keep channel in build metadata.
  case "$build" in
    nightly)
      prerelease_id="1"
      ;;
    beta)
      prerelease_id="2"
      ;;
    pre-release)
      prerelease_id="3"
      ;;
  esac

  version="${version}-${prerelease_id}+${build}"
fi

repo_root="$(cd "$(dirname "$0")" && pwd)"

client_package_json="$repo_root/packages/client/package.json"
tauri_config_json="$repo_root/packages/client/src-tauri/tauri.conf.json"
tauri_cargo_toml="$repo_root/packages/client/src-tauri/Cargo.toml"

update_json_version() {
  local file="$1"
  if ! grep -Eq '"version"[[:space:]]*:[[:space:]]*"[0-9]+\.[0-9]+\.[0-9]+' "$file"; then
    echo "Could not find a semver \"version\" field in $file" >&2
    exit 1
  fi

  perl -0777 -i -pe 's/("version"\s*:\s*")([0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?)(")/${1}'"$version"'${3}/' "$file"
}

update_toml_version() {
  local file="$1"
  if ! grep -Eq '^version[[:space:]]*=[[:space:]]*"[0-9]+\.[0-9]+\.[0-9]+' "$file"; then
    echo "Could not find a semver version entry in $file" >&2
    exit 1
  fi

  perl -i -pe 's/^(version\s*=\s*")([0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?)(")$/${1}'"$version"'${3}/' "$file"
}

update_json_version "$client_package_json"
update_json_version "$tauri_config_json"
update_toml_version "$tauri_cargo_toml"

echo "Updated client/settings version to $version in:"
echo "- $client_package_json"
echo "- $tauri_config_json"
echo "- $tauri_cargo_toml"
