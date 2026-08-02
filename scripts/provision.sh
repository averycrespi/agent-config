#!/bin/bash
# Provisioning script for https://github.com/averycrespi/agent-tools/tree/main/sandbox-manager
# Assumes that the repo is located at ~/work/agent-config

set -euo pipefail

cd ~/work/agent-config

echo "Stowing pi config"
make stow-pi

NODE_VERSION=$(awk '$1 == "nodejs" { print $2 }' .tool-versions)
if [[ -z "$NODE_VERSION" ]]; then
	echo "No nodejs version found in .tool-versions"
	exit 1
fi

echo "Installing asdf nodejs v$NODE_VERSION"
asdf install nodejs "$NODE_VERSION"

echo "Reshimming asdf nodejs"
asdf reshim nodejs

echo "Installing pi agent"
npm install -g --ignore-scripts @earendil-works/pi-coding-agent

echo "Installing node dependencies"
make install-dev

echo "Installing playwright dependencies"
make install-playwright

echo "Installing herdr"
curl -fsSL https://herdr.dev/install.sh | sh

MARKER_START="# >>> pi-alias >>>"
MARKER_END="# <<< pi-alias <<<"

if ! grep -qF "$MARKER_START" "$HOME/.bashrc" 2>/dev/null; then
	echo "Adding pi alias to ~/.bashrc"

	cat >>"$HOME/.bashrc" <<EOF

$MARKER_START
# Force pi to use the repo's configured Node.js version through asdf,
# even in repositories without a local nodejs resolution.
alias pi='ASDF_NODEJS_VERSION=$NODE_VERSION asdf exec pi'
$MARKER_END
EOF

else
	echo "pi alias already configured in ~/.bashrc"
fi

# ~/.config/herdr is a virtiofs mount from the host, so herdr's session and config
# survive sandbox rebuilds. But chmod() on a unix socket fails with EINVAL on
# virtiofs, and herdr chmods its sockets to 0600 right after binding — so the
# server dies at startup unless its sockets live on the guest filesystem.
echo "Pointing herdr sockets at the guest filesystem"
herdr_socket="$HOME/.local/state/herdr/herdr.sock"
mkdir -p "$(dirname "$herdr_socket")"

HERDR_MARKER_START="# >>> herdr-socket >>>"
HERDR_MARKER_END="# <<< herdr-socket <<<"

if ! grep -qF "$HERDR_MARKER_START" /etc/environment 2>/dev/null; then
	echo "Adding herdr socket path to /etc/environment"

	sudo tee -a /etc/environment >/dev/null <<EOF

$HERDR_MARKER_START
HERDR_SOCKET_PATH=$herdr_socket
$HERDR_MARKER_END
EOF

else
	echo "herdr socket path already configured in /etc/environment"
fi

if ! grep -qF "$HERDR_MARKER_START" "$HOME/.bashrc" 2>/dev/null; then
	echo "Adding herdr socket path to ~/.bashrc"

	cat >>"$HOME/.bashrc" <<EOF

$HERDR_MARKER_START
export HERDR_SOCKET_PATH="$herdr_socket"
$HERDR_MARKER_END
EOF

else
	echo "herdr socket path already configured in ~/.bashrc"
fi
