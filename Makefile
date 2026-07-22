.PHONY: install-dev install-playwright stow-claude unstow-claude stow-pi unstow-pi typecheck test

install-dev:
	npm install

install-playwright:
	npm install -g @playwright/cli@latest
	npm install -g playwright@latest
	playwright install-deps
	playwright install
	npx playwright-core install chromium

stow-claude:
	mkdir -p ~/.claude
	stow claude -t ~/.claude

unstow-claude:
	stow -D claude -t ~/.claude

stow-pi:
	mkdir -p ~/.pi/agent
	stow -d pi -t ~/.pi/agent agent

unstow-pi:
	stow -D -d pi -t ~/.pi/agent agent

typecheck:
	npx -p typescript tsc

test:
	npx tsx --test "pi/agent/extensions/**/*.test.ts" "pi/agent/workflows/**/*.test.ts"
