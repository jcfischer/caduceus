#!/usr/bin/env bash
# Caduceus postinstall — appends SKILLS_GUIDANCE to ~/.claude/CLAUDE.md so the
# model sees the "save complex workflows as skills" guidance in every session.
#
# Idempotent: only appends if the guidance block is not already present.
# Backs up CLAUDE.md with a timestamped .bak before modifying.

set -euo pipefail

CLAUDE_DIR="${CLAUDE_DIR:-$HOME/.claude}"
CLAUDE_MD="$CLAUDE_DIR/CLAUDE.md"
MARKER="## Skill Self-Improvement (Hermes Pattern)"

if [[ ! -f "$CLAUDE_MD" ]]; then
  echo "[caduceus] $CLAUDE_MD not found — skipping guidance append."
  echo "[caduceus] Paste examples/guidance-snippet.md into your CLAUDE.md manually."
  exit 0
fi

if grep -qF "$MARKER" "$CLAUDE_MD"; then
  echo "[caduceus] Guidance block already present in CLAUDE.md — skipping."
  exit 0
fi

stamp="$(date +%Y%m%d-%H%M%S)"
cp "$CLAUDE_MD" "$CLAUDE_MD.bak.$stamp"
echo "[caduceus] Backup: $CLAUDE_MD.bak.$stamp"

cat >> "$CLAUDE_MD" <<'EOF'

---

## Skill Self-Improvement (Hermes Pattern)

After completing a complex task (5+ tool calls), fixing a tricky error, or discovering a non-trivial workflow, save the approach as a skill via `Skill("skill-manage")` so it's reusable next time.

When using a skill and finding it outdated, incomplete, or wrong, patch it immediately with `skill-manage(action='patch')` — don't wait to be asked. Skills that aren't maintained become liabilities.

Storage: `~/.claude/skills/<name>/SKILL.md` (agentskills.io format, YAML frontmatter).

CLI: `bun ~/.claude/skills/skill-manage/scripts/skill-manage.ts <action> [args...]`

Actions: `create`, `edit`, `patch`, `delete`, `write_file`, `remove_file`, `list`.

The `SkillNudge` Stop handler writes a per-session marker when a turn used ≥5 tool calls, and the `SkillNudgeInject` UserPromptSubmit hook surfaces the nudge as a `<system-reminder>` on the next user prompt with captured context (user prompt, files touched, key commands).
EOF

echo "[caduceus] Guidance block appended."
echo "[caduceus] Restart your Claude Code session to load CLAUDE.md."
