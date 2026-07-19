.PHONY: install-dev install-playwright stow-claude stow-claude-sandbox unstow-claude stow-pi unstow-pi typecheck test

install-dev:
	npm install

install-playwright:
	npm install -g @playwright/cli@latest
	npm install -g playwright@latest
	playwright install-deps
	playwright install

stow-claude:
	mkdir -p ~/.claude
	stow claude -t ~/.claude

stow-claude-sandbox:
	mkdir -p ~/.claude
	rm -f ~/.claude/CLAUDE.md ~/.claude/settings.json
	stow -R claude -t ~/.claude
	rm -f ~/.claude/CLAUDE.md ~/.claude/settings.json
	cp claude/sandbox/CLAUDE.md ~/.claude/CLAUDE.md
	cp claude/sandbox/settings.json ~/.claude/settings.json

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
