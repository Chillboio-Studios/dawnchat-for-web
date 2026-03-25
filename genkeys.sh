#!/usr/bin/env bash
set -euo pipefail

KEY_REF="${1:-}"

if [ -z "$KEY_REF" ]; then
echo "Usage: $0 <gpg-key-id-or-email-or-fingerprint>"
echo "Example:"
echo " $0 1234ABCD5678EF90"
exit 1
fi

if ! gpg --list-secret-keys --with-colons | grep -q '^sec:'; then
echo "No secret GPG keys found in your keyring." >&2
echo "Create or import a signing key first, then rerun this script." >&2
echo "Tip: gpg --full-generate-key" >&2
exit 1
fi

if ! gpg --list-secret-keys --with-colons "$KEY_REF" | grep -q '^sec:'; then
echo "No secret key matched: $KEY_REF" >&2
echo "Available secret keys:" >&2
gpg --list-secret-keys --keyid-format=long >&2 || true
exit 1
fi

tmp_pub="$(mktemp)"
tmp_priv="$(mktemp)"

cleanup() {
if command -v shred >/dev/null 2>&1; then
shred -u "$tmp_pub" "$tmp_priv" 2>/dev/null || true
else
rm -f "$tmp_pub" "$tmp_priv"
fi
}
trap cleanup EXIT

gpg --batch --yes --export --armor "$KEY_REF" > "$tmp_pub"
gpg --batch --yes --export-secret-keys --armor "$KEY_REF" > "$tmp_priv"

if [ ! -s "$tmp_pub" ]; then
echo "Failed to export public key for: $KEY_REF" >&2
exit 1
fi

if [ ! -s "$tmp_priv" ]; then
echo "Failed to export private key for: $KEY_REF" >&2
exit 1
fi

b64_nowrap() {
if base64 --help 2>/dev/null | grep -q -- "-w"; then
base64 -w0
else
base64 | tr -d '\n'
fi
}

PUB_B64="$(cat "$tmp_pub" | b64_nowrap)"
PRIV_B64="$(cat "$tmp_priv" | b64_nowrap)"
FPR="$(gpg --with-colons --list-secret-keys "$KEY_REF" | awk -F: '/^fpr:/ {print $10; exit}')"

if [ -z "$FPR" ]; then
echo "Could not resolve fingerprint for key: $KEY_REF" >&2
exit 1
fi

echo
echo "Set these in GitHub Secrets:"
echo "FLATPAK_REPO_GPG_KEY_ID=$FPR"
echo "FLATPAK_REPO_GPG_KEY_BASE64=$PUB_B64"
echo "FLATPAK_REPO_GPG_PRIVATE_KEY_BASE64=$PRIV_B64"
echo

