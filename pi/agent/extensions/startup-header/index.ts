import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { loadGitMetadata, type GitMetadata } from "./git.ts";
import { renderHeader, type HeaderState } from "./render.ts";

export const _startupHeaderDeps = { loadGitMetadata };

export default function (pi: ExtensionAPI) {
  let metadata: GitMetadata = { commits: [] };
  let requestRender: (() => void) | undefined;
  let generation = 0;

  function buildState(cwd: string): HeaderState {
    return {
      piVersion: VERSION,
      cwd,
      repoName: metadata.repoName,
      branch: metadata.branch,
      commits: metadata.commits,
    };
  }

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    const currentGeneration = ++generation;
    metadata = { commits: [] };

    ctx.ui.setHeader((tui, theme) => {
      requestRender = () => tui.requestRender();
      return {
        render(width: number): string[] {
          return renderHeader(buildState(ctx.cwd), width, theme);
        },
        invalidate() {},
      };
    });

    void _startupHeaderDeps
      .loadGitMetadata(pi, ctx.cwd)
      .then((nextMetadata) => {
        if (currentGeneration !== generation) return;
        metadata = nextMetadata;
        requestRender?.();
      })
      .catch(() => {
        if (currentGeneration !== generation) return;
        metadata = { commits: [] };
        requestRender?.();
      });
  });

  pi.on("session_shutdown", async () => {
    generation++;
    requestRender = undefined;
    metadata = { commits: [] };
  });
}
