/**
 * GitHub URL handling — shallow clone repos, return README + file tree + path.
 */

import { execFile } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

/** Maximum repo size in MB before we refuse to clone. */
const MAX_REPO_SIZE_MB = 50;

/** Clone timeout in milliseconds. */
const CLONE_TIMEOUT_MS = 30_000;

/** Cached clone retention window in milliseconds. */
const CLONE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Base directory for cloned repos. */
const CLONE_BASE = "/tmp/pi-github-repos";

/** Directories to skip when building the file tree. */
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "vendor",
  ".next",
  "dist",
  "build",
  "__pycache__",
  ".venv",
  "venv",
]);

/** Binary file extensions to skip. */
const BINARY_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".svg",
  ".bmp",
  ".mp4",
  ".mov",
  ".avi",
  ".mp3",
  ".wav",
  ".zip",
  ".tar",
  ".gz",
  ".rar",
  ".7z",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".pdf",
  ".pyc",
  ".class",
  ".o",
  ".a",
  ".sqlite",
  ".db",
  ".lock",
]);

interface GitHubUrl {
  owner: string;
  repo: string;
  type?: "blob" | "tree";
  ref?: string;
  path?: string;
}

/** Parse a GitHub URL into its components. Returns null if not a GitHub repo URL. */
export function parseGitHubUrl(url: string): GitHubUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== "github.com") return null;

  const parts = parsed.pathname
    .replace(/^\//, "")
    .replace(/\/$/, "")
    .split("/");
  if (parts.length < 2 || !parts[0] || !parts[1]) return null;

  const result: GitHubUrl = {
    owner: parts[0],
    repo: parts[1].replace(/\.git$/, ""),
  };

  if (parts.length >= 4 && (parts[2] === "blob" || parts[2] === "tree")) {
    result.type = parts[2];
    result.ref = parts[3];
    if (parts.length > 4) {
      result.path = parts.slice(4).join("/");
    }
  }

  return result;
}

function exec(
  cmd: string,
  args: string[],
  options: { timeout?: number; cwd?: string; signal?: AbortSignal },
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout: options.timeout, cwd: options.cwd, signal: options.signal },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout);
      },
    );
  });
}

export function isGitHubRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (!/github/i.test(message)) return /rate limit/i.test(message);
  if (/\b429\b/.test(message)) return true;
  return /rate limit/i.test(message);
}

function sanitizeRefForPath(ref: string): string {
  return ref.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function getClonePath(gh: GitHubUrl): string {
  const repoDir = gh.ref
    ? `${gh.repo}--${sanitizeRefForPath(gh.ref)}`
    : gh.repo;
  return join(CLONE_BASE, gh.owner, repoDir);
}

function cleanupOldClones(now = Date.now()): void {
  let owners: string[];
  try {
    owners = readdirSync(CLONE_BASE);
  } catch {
    return;
  }

  for (const owner of owners) {
    const ownerPath = join(CLONE_BASE, owner);
    let repos: string[];
    try {
      if (!statSync(ownerPath).isDirectory()) continue;
      repos = readdirSync(ownerPath);
    } catch {
      continue;
    }

    for (const repo of repos) {
      const repoPath = join(ownerPath, repo);
      try {
        const stat = statSync(repoPath);
        if (!stat.isDirectory()) continue;
        if (now - stat.mtimeMs <= CLONE_RETENTION_MS) continue;
        rmSync(repoPath, { recursive: true, force: true });
      } catch {
        continue;
      }
    }
  }
}

/** Check repo size via GitHub's public API. Returns size in MB, or null if unavailable. */
async function getRepoSizeMB(
  owner: string,
  repo: string,
  signal?: AbortSignal,
): Promise<number | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "PiAgent/1.0",
        },
        signal,
      },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { size?: unknown };
    if (typeof body.size !== "number" || !Number.isFinite(body.size)) {
      return null;
    }
    return body.size / 1024;
  } catch {
    return null;
  }
}

/** Build a file tree string for a directory, skipping ignored paths. */
function buildTree(
  root: string,
  dir: string = root,
  prefix: string = "",
  maxEntries = 200,
): string {
  const lines: string[] = [];
  let count = 0;

  function walk(currentDir: string, indent: string) {
    if (count >= maxEntries) return;

    let entries: string[];
    try {
      entries = readdirSync(currentDir).sort();
    } catch {
      return;
    }

    for (const entry of entries) {
      if (count >= maxEntries) {
        lines.push(`${indent}... (truncated)`);
        return;
      }

      const fullPath = join(currentDir, entry);

      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        if (SKIP_DIRS.has(entry)) continue;
        lines.push(`${indent}${entry}/`);
        count++;
        walk(fullPath, indent + "  ");
      } else {
        const ext = entry.slice(entry.lastIndexOf(".")).toLowerCase();
        if (BINARY_EXTS.has(ext)) continue;
        lines.push(`${indent}${entry}`);
        count++;
      }
    }
  }

  walk(dir, prefix);
  return lines.join("\n");
}

/** Find and read the README file from a directory. */
function readReadme(dir: string): string | null {
  const candidates = [
    "README.md",
    "readme.md",
    "README",
    "README.rst",
    "README.txt",
  ];
  for (const name of candidates) {
    const path = join(dir, name);
    if (existsSync(path)) {
      try {
        return readFileSync(path, "utf-8");
      } catch {
        continue;
      }
    }
  }
  return null;
}

export interface GitHubFetchResponse {
  text: string;
  clonePath: string;
}

/**
 * Fetch a GitHub URL by cloning the repo. Returns README + file tree + clone path.
 * Throws on failure (too large, timeout, private, etc.).
 */
export async function fetchGitHub(
  gh: GitHubUrl,
  maxChars: number,
  signal?: AbortSignal,
): Promise<GitHubFetchResponse> {
  signal?.throwIfAborted();

  cleanupOldClones();

  // Check repo size
  const sizeMB = await getRepoSizeMB(gh.owner, gh.repo, signal);
  if (sizeMB !== null && sizeMB > MAX_REPO_SIZE_MB) {
    throw new Error(
      `Repository ${gh.owner}/${gh.repo} is ${Math.round(sizeMB)}MB (limit: ${MAX_REPO_SIZE_MB}MB). Use web_fetch on a specific file URL instead.`,
    );
  }

  const clonePath = getClonePath(gh);

  // Clone if not already present
  if (!existsSync(join(clonePath, ".git"))) {
    const cloneUrl = `https://github.com/${gh.owner}/${gh.repo}.git`;
    const cloneArgs = ["clone", "--depth", "1", "--single-branch"];
    if (gh.ref) {
      cloneArgs.push("--branch", gh.ref);
    }
    cloneArgs.push(cloneUrl, clonePath);
    await exec("git", cloneArgs, {
      timeout: CLONE_TIMEOUT_MS,
      signal,
    });
  }

  // If pointing at a specific file, return its contents
  if (gh.type === "blob" && gh.path) {
    const filePath = join(clonePath, gh.path);
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${gh.path}`);
    }
    const content = readFileSync(filePath, "utf-8");
    let text = `## ${gh.path}\n\n\`\`\`\n${content}\n\`\`\`\n\nRepository cloned to \`${clonePath}\``;
    if (text.length > maxChars) {
      text =
        text.slice(0, maxChars) +
        `\n\n[Content truncated — ${text.length.toLocaleString()} total characters. Use max_chars to read more.]`;
    }
    return { text, clonePath };
  }

  // Build overview: README + file tree
  const targetDir = gh.path ? join(clonePath, gh.path) : clonePath;
  const parts: string[] = [];

  parts.push(`Repository cloned to \`${clonePath}\``);

  const readme = readReadme(targetDir);
  if (readme) {
    parts.push(`## README\n\n${readme}`);
  }

  const tree = buildTree(targetDir);
  if (tree) {
    parts.push(`## File tree\n\n\`\`\`\n${tree}\n\`\`\``);
  }

  let text = parts.join("\n\n");
  if (text.length > maxChars) {
    text =
      text.slice(0, maxChars) +
      `\n\n[Content truncated — ${text.length.toLocaleString()} total characters. Use max_chars to read more.]`;
  }

  return { text, clonePath };
}
