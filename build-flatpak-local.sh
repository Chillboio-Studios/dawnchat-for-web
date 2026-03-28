#!/usr/bin/env bash
set -euo pipefail

cd /home/fttristan/Repos/otube-for-web

flatpak remote-add --user --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
flatpak install --user -y flathub org.gnome.Platform//48 org.gnome.Sdk//48

if command -v nvm >/dev/null 2>&1; then
	nvm use 25
else
	export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
	if [[ -s "$NVM_DIR/nvm.sh" ]]; then
		# shellcheck disable=SC1090
		source "$NVM_DIR/nvm.sh"
		nvm use 25
	else
		echo "[build-flatpak-local] nvm not found; using current Node runtime"
		if ! command -v node >/dev/null 2>&1; then
			echo "[build-flatpak-local] error: node is not installed and nvm is unavailable" >&2
			exit 1
		fi
	fi
fi

pnpm install
pnpm --filter client exec lingui compile --typescript

OTUBE_LINUX_FLAVOR=flatpak-local pnpm --filter client exec node ./scripts/build-desktop.mjs linux-nobundle

flatpak-builder --force-clean --repo=repo flatpak-build-dir packaging/flatpak/com.chillboiostudios.dawnchat.yml
flatpak build-bundle repo DawnChat-local.flatpak com.chillboiostudios.dawnchat
flatpak install --user -y --reinstall DawnChat-local.flatpak

flatpak run com.chillboiostudios.dawnchat
