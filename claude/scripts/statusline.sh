#!/usr/bin/env bash
# Claude Code status line: working dir, git branch with status markers,
# five-hour session usage, and seven-day weekly usage.
#
# Git markers: +N staged, !N modified, ?N untracked, ↑N ahead, ↓N behind.
# Usage segments appear only when Claude Code supplies rate_limits
# (claude.ai subscriptions, after the session's first response).
# Requires bash 3.2+, jq, and git.

input="$(cat)"

# Unit separator, not tab: read collapses consecutive whitespace separators,
# which would shift fields when a value is empty.
IFS=$'\037' read -r dir five week < <(
  jq -r '[
    (.workspace.current_dir // .cwd // ""),
    (.rate_limits.five_hour.used_percentage // "" | tostring),
    (.rate_limits.seven_day.used_percentage // "" | tostring)
  ] | join("\u001f")' <<<"$input" 2>/dev/null
)

reset=$'\033[0m'
dim=$'\033[2m'
blue=$'\033[34m'
green=$'\033[32m'
yellow=$'\033[33m'
red=$'\033[31m'

out=""

if [ -n "$dir" ]; then
  case "$dir" in
    "$HOME") short="~" ;;
    "$HOME"/*) short="~${dir#"$HOME"}" ;;
    *) short="$dir" ;;
  esac
  out="${blue}${short}${reset}"
fi

# One porcelain v2 call gives branch, upstream divergence, and file states.
# --no-optional-locks avoids contending with git commands running elsewhere.
if [ -n "$dir" ] && status="$(git -C "$dir" --no-optional-locks status --porcelain=v2 --branch 2>/dev/null)"; then
  git_info="$(awk '
    /^# branch.oid / { oid = substr($3, 1, 7) }
    /^# branch.head / { head = $3 }
    /^# branch.ab / { ahead = substr($3, 2) + 0; behind = substr($4, 2) + 0 }
    /^[12] / {
      if (substr($2, 1, 1) != ".") staged++
      if (substr($2, 2, 1) != ".") modified++
    }
    /^u / { modified++ }
    /^\? / { untracked++ }
    END {
      if (head == "(detached)") head = oid
      marks = ""
      if (staged) marks = marks " +" staged
      if (modified) marks = marks " !" modified
      if (untracked) marks = marks " ?" untracked
      if (ahead) marks = marks " ↑" ahead
      if (behind) marks = marks " ↓" behind
      printf "%s\t%s", head, marks
    }' <<<"$status")"
  branch="${git_info%%$'\t'*}"
  marks="${git_info#*$'\t'}"
  if [ -n "$branch" ]; then
    color="$green"
    [ -n "$marks" ] && color="$yellow"
    out="${out}  ${color}${branch}${marks}${reset}"
  fi
fi

# Color a usage percentage by how close it is to the limit.
usage() {
  local label="$1" pct="$2" whole color
  [ -n "$pct" ] || return 0
  whole="$(printf '%.0f' "$pct" 2>/dev/null)" || return 0
  color="$green"
  [ "$whole" -ge 50 ] && color="$yellow"
  [ "$whole" -ge 80 ] && color="$red"
  printf '%s%s %s%s%%%s' "$dim" "$label" "$color" "$whole" "$reset"
}

session="$(usage session "$five")"
weekly="$(usage week "$week")"
[ -n "$session" ] && out="${out}  ${session}"
[ -n "$weekly" ] && out="${out}  ${weekly}"

printf '%s\n' "$out"
