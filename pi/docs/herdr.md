# Herdr integration

[Back to the Pi configuration reference](../README.md#herdr-integration).

## Component ownership and installation

The Herdr integration has three distinct ownership boundaries:

- The repository-owned [`herdr` skill](../agent/skills/herdr/SKILL.md#manage-git-worktrees) owns worktree-management procedures, including discovery, checkout paths, focus, removal, and verification. [`spin-out`](../agent/skills/spin-out/SKILL.md) adds the purpose-specific delegation workflow.
- The repository-owned [`ask-user` extension](../agent/extensions/ask-user/README.md) emits balanced `herdr:blocked` events while an interactive question is open.
- Herdr owns the generated `herdr-agent-state.ts` lifecycle bridge. It reports Pi session identity and `working`, `blocked`, and `idle` state to the current Herdr pane.

Install or update the bridge after `make stow-pi` so Herdr writes it through the managed `~/.pi/agent/extensions` symlink:

```sh
herdr integration install pi
herdr integration status
```

The generated bridge is a local installer artifact: do not edit or commit it. Re-running the install command may overwrite it. Restart Pi or run `/reload` after installing or updating the bridge. The repository's [provisioning script](../../scripts/provision.sh) performs the installation automatically.

## macOS client with a Lima guest

When the Herdr server and Pi run inside Lima, start the interactive Herdr client on macOS with remote attach instead of opening an SSH shell and running `herdr` inside the guest. A guest-only client receives a Finder drop as an absolute macOS path such as `/var/folders/.../TemporaryItems/NSIRD_screencaptureui_...png`, which does not exist in the guest. A local remote client reads the host image immediately, transfers it over Herdr's SSH connection, stages it as a guest-local file, and pastes that readable path into the target pane.

Install Herdr on both macOS and the guest, and keep their versions compatible. On macOS, expose Lima's generated SSH hosts to normal OpenSSH by adding this at top level near the beginning of `~/.ssh/config`:

```sshconfig
Include ~/.lima/*/ssh.config
```

List the instances and generated SSH configuration files, then inspect the relevant file for its `Host` alias:

```sh
limactl ls --format '{{.Name}}\t{{.SSHConfigFile}}'
grep '^Host ' ~/.lima/<instance>/ssh.config
```

Verify ordinary SSH access before involving Herdr:

```sh
ssh lima-<instance> 'hostname && herdr --version'
```

If alias resolution fails, test the generated configuration directly with `ssh -F ~/.lima/<instance>/ssh.config lima-<instance>` and fix the top-level `Include`. Detach any client currently running through an SSH shell with `Ctrl+B`, then `Q`; this leaves the guest server and panes running. Exit that shell and attach from macOS:

```sh
herdr --remote lima-<instance>
```

For a named Herdr session, add `--session <name>`. Do not run plain `herdr` on macOS for this workflow, because that opens a separate macOS-local server rather than the Lima-hosted session.

While attached remotely:

- Finder-dropped PNG, JPEG, GIF, WebP, and BMP files are copied into a private guest staging directory before their guest path reaches Pi.
- `Ctrl+V` uses Herdr's default `keys.remote_image_paste` binding to bridge an image from the macOS clipboard.
- Keep the client attached until Pi has consumed the staged image.
- Pi agents remain inside Lima and continue to control the guest Herdr server through the normal `herdr` CLI and injected `HERDR_*` pane context.

Verify the agent-side control path from a Pi pane:

```sh
printf '%s\n' "$HERDR_ENV" "$HERDR_WORKSPACE_ID" "$HERDR_TAB_ID" "$HERDR_PANE_ID"
herdr pane current --current
herdr agent list
```

A successful image drop produces a guest-readable path similar to `/tmp/herdr-clipboard-images-<uid>/client-<id>-0.png`; Pi's `read` tool should recognize it as an image. This setup requires no `/var/folders` mount. Avoid mounting that host tree: it exposes unrelated temporary data and does not eliminate the screenshot thumbnail's short-lifetime race.

## References

- [Herdr remote access](https://herdr.dev/docs/persistence-remote/)
- [Herdr remote workflow](https://herdr.dev/docs/how-to-work/)
- [Lima SSH configuration](https://lima-vm.io/docs/usage/ssh/)
