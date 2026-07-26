.PHONY: install-dev install-playwright stow-pi unstow-pi typecheck test

install-dev:
	npm install

install-playwright:
	npm install -g @playwright/cli@latest
	npm install -g playwright@latest
	@if command -v asdf >/dev/null 2>&1 && asdf current nodejs >/dev/null 2>&1; then asdf reshim nodejs; fi
	playwright install-deps
	playwright install
	npx playwright-core install chromium

stow-pi:
	mkdir -p ~/.pi/agent
	stow -d pi -t ~/.pi/agent agent

unstow-pi:
	stow -D -d pi -t ~/.pi/agent agent

typecheck:
	npx -p typescript tsc

test:
	npx tsx --test "pi/agent/extensions/**/*.test.ts" "pi/agent/workflows/**/*.test.ts"
