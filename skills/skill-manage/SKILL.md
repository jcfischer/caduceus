---
name: skill-manage
description: Create, edit, patch, or delete user skills. Invoke after a complex task (5+ tool calls), after fixing a tricky bug, or when a loaded skill turned out to be wrong or incomplete. Turns proven approaches into reusable procedural memory.
triggers:
  - skill-manage
  - save as skill
  - create skill
  - patch skill
  - update skill
---

# skill-manage

Ported from `hermes-agent/tools/skill_manager_tool.py`. Lets you turn successful approaches into reusable skills stored at `~/.claude/skills/<name>/SKILL.md`.

## When to Use

Invoke via `Bash` with the helper script (no Python tool runtime here — PAI runs on Claude Code, so actions are shell calls):

```
bun ~/.claude/skills/skill-manage/scripts/skill-manage.ts <action> [args...]
```

**Invoke when:**
- Just completed a non-trivial task (≥5 tool calls, trial-and-error, course corrections)
- Fixed a tricky error whose root cause is non-obvious
- Discovered a workflow that outperforms defaults
- Used an existing skill and found it outdated, missing steps, or wrong

**Don't invoke when:**
- Task was trivial (1-2 tool calls, no gotchas)
- Approach is already captured in an existing skill (check `ls ~/.claude/skills/`)
- The "skill" would just be generic advice

## Actions

| Action | Purpose |
|--------|---------|
| `create` | New skill: writes `~/.claude/skills/<name>/SKILL.md` |
| `edit` | Full rewrite of an existing skill's `SKILL.md` |
| `patch` | Find-and-replace within `SKILL.md` or a supporting file |
| `delete` | Remove a user-created skill |
| `write_file` | Add/overwrite `references/*.md`, `scripts/*`, `templates/*` |
| `remove_file` | Remove a supporting file |
| `list` | List all user skills |

## CLI Surface

```bash
# Create
bun ~/.claude/skills/skill-manage/scripts/skill-manage.ts create <name> --content <path-to-SKILL.md> [--category <cat>]
# Or inline via stdin:
cat SKILL.md | bun ~/.claude/skills/skill-manage/scripts/skill-manage.ts create <name> --stdin [--category <cat>]

# Patch
bun ~/.claude/skills/skill-manage/scripts/skill-manage.ts patch <name> --old <string> --new <string> [--file <relpath>] [--replace-all]

# Edit (full rewrite)
bun ~/.claude/skills/skill-manage/scripts/skill-manage.ts edit <name> --content <path>

# Delete
bun ~/.claude/skills/skill-manage/scripts/skill-manage.ts delete <name>

# Supporting files
bun ~/.claude/skills/skill-manage/scripts/skill-manage.ts write_file <name> <relpath> --content <path>
bun ~/.claude/skills/skill-manage/scripts/skill-manage.ts remove_file <name> <relpath>

# List
bun ~/.claude/skills/skill-manage/scripts/skill-manage.ts list
```

All actions return JSON: `{"success": true|false, "message"|"error": "...", ...}`.

## SKILL.md Format (required for `create`/`edit`)

```markdown
---
name: <kebab-case-name>
description: <one-sentence, with "invoke when" phrasing>
triggers:
  - <keyword>
  - <another keyword>
---

# <Title>

## When to Use

## Steps / Actions

## Notes
```

The helper validates:
- `name` matches `^[a-z][a-z0-9-]{1,63}$`
- Frontmatter parses as YAML with `name` and `description` fields
- Content size < 200KB
- No collision with an existing skill under `~/.claude/skills/`

## Self-Patching Rule

If you loaded a skill and discovered its commands are wrong, its steps missing, or it leads you astray — patch it **immediately** with `patch` action. Don't defer. Unmaintained skills become liabilities.

## Storage

User skills: `~/.claude/skills/<name>/` (or `~/.claude/skills/<category>/<name>/` if category provided).

Structure:
```
~/.claude/skills/my-skill/
├── SKILL.md
├── references/
├── scripts/
└── templates/
```

## Related

- Hermes source: `hermes-agent/tools/skill_manager_tool.py`
- Port notes: `~/.claude/MEMORY/WORK/20260422-155037_hermes-self-improve-extract/PRD.md`
