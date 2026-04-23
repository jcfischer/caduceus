# Caduceus ☤

**Self-improving skills for Claude Code, ported from [Nous Research's Hermes Agent](https://github.com/NousResearch/hermes-agent).**

Caduceus gives Claude Code the ability to turn successful workflows into reusable **skills** — automatically suggested at the end of complex turns, saved with a single tool call, and patched in-flight when they turn out to be wrong.

> Named after Hermes' staff — the two intertwined snakes mirror the two-loop design: one snake is the `skill-manage` CRUD tool (the agent writes skills), the other is the `SkillNudge` Stop + `SkillNudgeInject` UserPromptSubmit pair (the runtime prompts the agent to save).

## Why

Out of the box, Claude Code has skills you can load — but no path for the agent to *create* new ones from live sessions. Hermes Agent solved this with:

1. **Prompt guidance** telling the model to save reusable workflows as skills after 5+ tool calls.
2. **An iteration counter** that nudges after N tool-use blocks.
3. **A background review fork** that proposes saves unobtrusively.
4. **A `skill_manage` tool** with create/edit/patch/delete actions.

Caduceus ports the first two and the tool directly into Claude Code. The background fork (v2) is on the roadmap.

## What's in the box

```
caduceus/
├── arc-manifest.yaml             # arc/v1 manifest — install, file map, hook registration
├── package.json                  # bun meta
├── skills/
│   ├── skill-manage/             # the meta-skill: create / edit / patch / delete user skills
│   │   ├── SKILL.md
│   │   └── scripts/skill-manage.ts
│   └── skill-stats/              # v0.2.0: usage analytics reporter
│       ├── SKILL.md
│       └── scripts/skill-stats.ts
├── hooks/
│   ├── SkillNudgeInject.hook.ts  # UserPromptSubmit → injects <system-reminder>
│   ├── SkillLoadLogger.hook.ts   # v0.2.0: PreToolUse on Skill → logs `loaded` event
│   ├── handlers/SkillNudge.ts    # Stop → counts tool_use, writes per-session marker
│   └── lib/skill-stats-log.ts    # v0.2.0: shared jsonl emitter
├── scripts/postinstall.sh        # idempotent CLAUDE.md guidance append
├── examples/guidance-snippet.md  # reference copy of the CLAUDE.md block
└── docs/
    ├── architecture.md
    ├── settings-registration.md  # manual fallback for non-arc installs
    └── hermes-origin.md
```

## v0.3.1 — Docs refresh (patch release)

Documentation catch-up only: `docs/architecture.md` and `docs/hermes-origin.md` now cover v0.2.0 analytics + v0.3.0 diff preview that shipped ahead of doc updates.

## v0.3.0 — Patch-failure diff preview

When `skill-manage patch` fails because the old string wasn't found (or matched multiple times), the response now includes a `preview` field with diff-like context so the model can self-correct without re-reading the whole file:

```json
{
  "success": false,
  "error": "old string not found in SKILL.md",
  "preview": "Patch could not find the old string. Closest match in file: line 12 (47% overlap...)\n\nYou tried to match:\n- This is line tow in section A.\n\nFile excerpt around line 12:\n 9   \n10   ## Section A\n11   This is line one in section A.\n12 » This is line two in section A.\n13   This line appears twice below as well.\n14   ..."
}
```

For multiple matches: shows up to 3 match locations with line numbers + ±2 lines of context.

Port of hermes-agent's `format_no_match_hint` UX. Full multi-strategy fuzzy matching (whitespace-insensitive, indent-flexible, block-anchor) is separate — this ships the UX fix that matters most on patch failures.

## v0.2.0 — Skill usage analytics

Every caduceus event (nudge fired, nudge injected, skill loaded, created, patched, deleted) writes a JSONL line to `~/.claude/MEMORY/STATE/skill-stats.jsonl`.

The `skill-stats` reporter surfaces signal:

```bash
$ skill-stats summary              # event counts + nudge→save funnel (default)
$ skill-stats loaded --limit 10    # most-loaded skills
$ skill-stats drift                # skills ranked by patch frequency
$ skill-stats unused --days 30     # installed but never-loaded
$ skill-stats nudges               # nudge_fired → injected → created/patched funnel
$ skill-stats raw --limit 50       # recent events
```

All subcommands accept `--days N` (window) and `--json` (machine-readable).

This exists because Luna's pushback on the v2 plan was correct: you can't tune a background reviewer (feature #1) without baseline data on what the v1 nudge already produces. Analytics ships first so we can measure before changing.

## Install

Caduceus installs via [arc](https://github.com/jcfischer/arc) (agentic component package manager):

```bash
arc install github:<your-github>/caduceus
```

arc reads `arc-manifest.yaml` and:
1. Copies the skill and hook files to `~/.claude/skills/skill-manage/` and `~/.claude/hooks/`
2. Registers the Stop and UserPromptSubmit hooks in `~/.claude/settings.json`
3. Runs `scripts/postinstall.sh` which appends the `SKILLS_GUIDANCE` block to `~/.claude/CLAUDE.md` (idempotent, backed up)

Start a new Claude Code session to pick up the changes.

### Manual install

If you don't use arc, see `docs/settings-registration.md` for the file-by-file instructions + hook registration snippets.

## How it works

End-of-turn loop:

```
┌──────────────────────────────┐
│  assistant finishes response │
└─────────────┬────────────────┘
              │  Stop event
              ▼
  hooks/handlers/SkillNudge.ts
    · parses transcript
    · counts tool_use blocks since last user-text message
    · captures: user prompt, files touched, first Bash commands, last assistant text
    · writes ~/.claude/MEMORY/STATE/skill-nudge-pending-<session_id>.json
              │
              │  (user sends next prompt)
              ▼
   hooks/SkillNudgeInject.hook.ts
    · reads marker matching this session_id
    · emits <system-reminder> with rich context
    · deletes marker (one-shot)
              │
              ▼
┌──────────────────────────────┐
│  agent sees the reminder and │
│  proposes skill-save (or not)│
└──────────────────────────────┘
```

In-flight skill patching:

```
agent loads skill → finds step wrong → Skill("skill-manage") patch action → continues task
```

## Uninstall

```bash
arc remove caduceus
```

Removes files, un-registers hooks from `settings.json`, and leaves `CLAUDE.md` with the guidance block (remove the `## Skill Self-Improvement (Hermes Pattern)` section manually if you want it gone).

## Default threshold

5 tool calls per turn. Override with `SKILL_NUDGE_THRESHOLD=10` in your shell env.

## Session scoping

Markers are per-session (`skill-nudge-pending-<session_id>.json`) so parallel Claude Code sessions don't consume each other's nudges. This was a real bug discovered during MVP — see `docs/architecture.md`.

## CLI reference

```bash
# Create
bun skill-manage.ts create <name> --content <path-to-SKILL.md> [--category <cat>]

# Full rewrite
bun skill-manage.ts edit <name> --content <path>

# Targeted find-replace (fails on non-unique match unless --replace-all)
bun skill-manage.ts patch <name> --old "..." --new "..." [--file references/foo.md] [--replace-all]

# Delete
bun skill-manage.ts delete <name>

# Supporting files
bun skill-manage.ts write_file <name> <relpath> --content <path>
bun skill-manage.ts remove_file <name> <relpath>

# Enumerate
bun skill-manage.ts list
```

All actions return JSON: `{"success": true|false, "message"|"error": "..."}`.

Skills live at `~/.claude/skills/<name>/` or `~/.claude/skills/<category>/<name>/`, [agentskills.io](https://agentskills.io)-compatible YAML frontmatter.

## Not in v1 (roadmap)

- **Background review subagent** — hermes forks an AIAgent after each turn that proposes skill saves autonomously. Caduceus will add this via `Agent(run_in_background=true)` once the Claude Code hook surface stabilises.
- **Security scanner port** — hermes has `skills_guard` that scans agent-created skills for dangerous patterns. Caduceus accepts whatever the agent writes.
- **Fuzzy patch matching** — hermes has a fuzzy matcher that handles whitespace/indent drift. Caduceus uses exact string match.
- **Skill usage analytics** — which skills fire most, which get patched, which never load.

## Prior art / credit

- [hermes-agent](https://github.com/NousResearch/hermes-agent) — Nous Research, MIT license. The self-improving loop pattern is theirs. Caduceus is a Claude Code adaptation, not a fork.
- [agentskills.io](https://agentskills.io) — skill file format.

## License

MIT. See `LICENSE`.
