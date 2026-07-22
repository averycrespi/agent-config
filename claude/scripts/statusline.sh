#!/bin/bash
# Claude Code statusline with powerline style and git status
# Uses nerd fonts and ANSI colors for rainbow effect
#
# Adapted from https://github.com/pchalasani/claude-code-tools
# Copyright 2025 Prasad Chalasani, MIT License

input=$(cat)

# Validate JSON and extract fields safely
if ! echo "$input" | jq -e . >/dev/null 2>&1; then
	echo "⚠ invalid input"
	exit 0
fi

cwd=$(echo "$input" | jq -r '.workspace.current_dir // empty' 2>/dev/null)
dir_name=$(basename "$cwd" 2>/dev/null || echo "?")

# Extract model - could be string or object with .id field
model=$(echo "$input" | jq -r '
  if .model | type == "object" then .model.id // .model.name // "claude"
  elif .model | type == "string" then .model
  else "claude"
  end
' 2>/dev/null)
[ -z "$model" ] || [ "$model" = "null" ] && model="claude"
# Clean up model name - remove claude- prefix, context suffix, and date suffix
model="${model#claude-}" # remove claude- prefix
model="${model%%\[*}"    # remove [1m] context suffix
model=$(echo "$model" | sed 's/-[0-9]\{8,\}$//' | cut -c1-12)

# ANSI color codes (using $'...' for proper escape handling)
RESET=$'\033[0m'
BG_BLUE=$'\033[44m'
FG_BLUE=$'\033[34m'
BG_GREEN=$'\033[42m'
FG_GREEN=$'\033[32m'
BG_YELLOW=$'\033[43m'
FG_YELLOW=$'\033[33m'
BG_CYAN=$'\033[46m'
FG_CYAN=$'\033[36m'
BG_RED=$'\033[41m'
FG_RED=$'\033[31m'
BG_ORANGE=$'\033[48;5;208m'
FG_ORANGE=$'\033[38;5;208m'
BG_MAGENTA=$'\033[45m'
FG_MAGENTA=$'\033[35m'
FG_BLACK=$'\033[30m'
FG_WHITE=$'\033[97m'
BOLD=$'\033[1m'
BLINK=$'\033[5m'

# Powerline separator
SEP=''

# Git info - check status first to determine model background color
git_segment=""
model_bg=$BG_GREEN # default to green
model_fg=$FG_GREEN
if git -C "$cwd" rev-parse --git-dir >/dev/null 2>&1; then
	branch=$(git -C "$cwd" branch --show-current 2>/dev/null)
	[ -z "$branch" ] && branch=$(git -C "$cwd" rev-parse --short HEAD 2>/dev/null)

	# Get status counts
	status=$(git -C "$cwd" status --porcelain 2>/dev/null)
	staged=$(echo "$status" | grep -c '^[MADRC]')
	modified=$(echo "$status" | grep -c '^.[MD]')

	# Ahead/behind
	ahead=$(git -C "$cwd" rev-list --count @{u}..HEAD 2>/dev/null || echo 0)
	behind=$(git -C "$cwd" rev-list --count HEAD..@{u} 2>/dev/null || echo 0)

	# Build compact git status (starship style)
	git_status=""
	[ "$ahead" -gt 0 ] 2>/dev/null && git_status+="⇡$ahead"
	[ "$behind" -gt 0 ] 2>/dev/null && git_status+="⇣$behind"
	[ "$staged" -gt 0 ] && git_status+="+$staged"
	[ "$modified" -gt 0 ] && git_status+="!$modified"

	# Choose color - light blue for branch, green/yellow for model based on status
	BG_LTBLUE=$'\033[48;5;75m'
	FG_LTBLUE=$'\033[38;5;75m'
	if [ -n "$git_status" ]; then
		git_bg=$BG_LTBLUE
		git_fg=$FG_LTBLUE
		model_bg=$BG_YELLOW
		model_fg=$FG_YELLOW
		git_content=" $branch $git_status "
	else
		git_bg=$BG_LTBLUE
		git_fg=$FG_LTBLUE
		model_bg=$BG_GREEN
		model_fg=$FG_GREEN
		git_content=" $branch "
	fi
	git_segment="${FG_BLUE}${git_bg}${SEP}${FG_BLACK}${git_content}"
	next_fg=$git_fg
	next_bg=$BG_CYAN
else
	next_fg=$FG_BLUE
	next_bg=$BG_CYAN
fi

# Context usage
context_segment=""
BG_DARK=$'\033[48;5;236m'
FG_DARK=$'\033[38;5;236m'
pct=$(echo "$input" | jq '.context_window.used_percentage // empty' 2>/dev/null)
if [ -n "$pct" ] && [ "$pct" != "null" ] && [ "$pct" -ge 0 ] 2>/dev/null; then
	# Color based on level
	if [ "$pct" -gt 95 ]; then
		pct_color=$'\033[38;5;196m' # bright red
	elif [ "$pct" -gt 85 ]; then
		pct_color=$'\033[38;5;208m' # orange
	elif [ "$pct" -gt 70 ]; then
		pct_color=$'\033[38;5;220m' # yellow
	else
		pct_color=$FG_WHITE
	fi
	context_segment="${next_fg}${BG_DARK}${SEP}${FG_WHITE} ctx: ${pct_color}${pct}%${RESET}"
	next_fg=$FG_DARK
else
	context_segment="${next_fg}${BG_DARK}${SEP}${FG_WHITE} ctx: --%${RESET}"
	next_fg=$FG_DARK
fi

# Session usage (5-hour rolling window)
session_segment=""
session_pct=$(echo "$input" | jq '.rate_limits.five_hour.used_percentage // empty' 2>/dev/null)
if [ -n "$session_pct" ] && [ "$session_pct" != "null" ] && [ "$session_pct" -ge 0 ] 2>/dev/null; then
	if [ "$session_pct" -gt 95 ]; then
		s_pct_color=$'\033[38;5;196m'
	elif [ "$session_pct" -gt 85 ]; then
		s_pct_color=$'\033[38;5;208m'
	elif [ "$session_pct" -gt 70 ]; then
		s_pct_color=$'\033[38;5;220m'
	else
		s_pct_color=$FG_WHITE
	fi
	session_segment="${FG_DARK}${BG_DARK}${SEP}${FG_WHITE} session: ${s_pct_color}${session_pct}%${RESET}"
else
	session_segment="${FG_DARK}${BG_DARK}${SEP}${FG_WHITE} session: --%${RESET}"
fi

# Weekly usage (7-day rolling window)
weekly_segment=""
weekly_pct=$(echo "$input" | jq '.rate_limits.seven_day.used_percentage // empty' 2>/dev/null)
if [ -n "$weekly_pct" ] && [ "$weekly_pct" != "null" ] && [ "$weekly_pct" -ge 0 ] 2>/dev/null; then
	if [ "$weekly_pct" -gt 95 ]; then
		w_pct_color=$'\033[38;5;196m'
	elif [ "$weekly_pct" -gt 85 ]; then
		w_pct_color=$'\033[38;5;208m'
	elif [ "$weekly_pct" -gt 70 ]; then
		w_pct_color=$'\033[38;5;220m'
	else
		w_pct_color=$FG_WHITE
	fi
	weekly_segment="${FG_DARK}${BG_DARK}${SEP}${FG_WHITE} week: ${w_pct_color}${weekly_pct}%${RESET}"
else
	weekly_segment="${FG_DARK}${BG_DARK}${SEP}${FG_WHITE} week: --%${RESET}"
fi

# Build output with powerline style
# Sandbox prefix
BG_PURPLE=$'\033[48;5;141m'
FG_PURPLE=$'\033[38;5;141m'
echo -n "${BG_PURPLE}${FG_BLACK}${BOLD} sandbox ${RESET}"
echo -n "${FG_PURPLE}${model_bg}${SEP}${FG_BLACK}${BOLD} $model ${RESET}"
echo -n "${model_fg}${BG_BLUE}${SEP}${FG_BLACK}  $dir_name ${RESET}"
echo -n "$git_segment"
echo -n "$context_segment"
echo -n "$session_segment"
echo -n "$weekly_segment"
echo -n "${FG_DARK}${RESET}${SEP}"
