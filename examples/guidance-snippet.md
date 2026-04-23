# SKILLS_GUIDANCE block

Append this to `~/.claude/CLAUDE.md` so the model sees the guidance in every session.

```markdown
## Skill Self-Improvement (Hermes Pattern)

After completing a complex task (5+ tool calls), fixing a tricky error, or discovering a non-trivial workflow, save the approach as a skill via `Skill("skill-manage")` so it's reusable next time.

When using a skill and finding it outdated, incomplete, or wrong, patch it immediately with `skill-manage(action='patch')` — don't wait to be asked. Skills that aren't maintained become liabilities.

Storage: `~/.claude/skills/<name>/SKILL.md` (agentskills.io format, YAML frontmatter).

CLI: `bun ~/.claude/skills/skill-manage/scripts/skill-manage.ts <action> [args...]`

Actions: `create`, `edit`, `patch`, `delete`, `write_file`, `remove_file`, `list`.

The `SkillNudge` Stop handler writes a per-session marker when a turn used ≥5 tool calls, and the `SkillNudgeInject` UserPromptSubmit hook surfaces the nudge as a `<system-reminder>` on the next user prompt with captured context (user prompt, files touched, key commands).
```

Ported from `hermes-agent/agent/prompt_builder.py:170` (SKILLS_GUIDANCE constant).
