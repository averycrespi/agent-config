#!/bin/bash
# Provisioning script for https://github.com/averycrespi/agent-tools/tree/main/sandbox-manager

set -euo pipefail

command_exists() { command -v "$1" &>/dev/null; }

cd ~/work/agent-config

echo "Stowing Claude sandbox config"
make stow-claude-sandbox

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

echo "Installing agent-config dependencies"
npm install

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

if ! command_exists curl; then
	echo "Installing curl (required to fetch the Claude Code installer)"
	sudo apt-get update -qq
	sudo apt-get install -y -qq curl
else
	echo "curl already installed"
fi

if ! command_exists claude; then
	echo "Installing Claude Code (native binary)"
	curl -fsSL https://claude.ai/install.sh | bash
else
	echo "Claude Code already installed"
fi
