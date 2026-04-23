# Architecture

## Three cooperating pieces

### 1. `skills/skill-manage` — the meta-skill

A skill whose job is to create/edit/patch/delete other skills. Invoked via Claude Code's `Skill` tool or directly via its Bun helper `scripts/skill-manage.ts`.

**Why a Bun script and not a PAI tool?** PAI runs on Claude Code, which has no plugin API for custom runtime tools. A Bun CLI invoked through `Bash` is the idiomatic path and matches how other PAI skills (`Calendar`, `email`, `ical`) work.

Actions implemented:

| Action | Purpose | Validation |
|--------|---------|-----------|
| `create` | Write new `SKILL.md` | name regex, category regex, frontmatter, size (200KB) |
| `edit` | Replace `SKILL.md` | frontmatter + size |
| `patch` | Find/replace in SKILL.md or a supporting file | requires unique match unless `--replace-all` |
| `delete` | Recursive remove | only user skills |
| `write_file` | Add/overwrite supporting file | relative path confined to `references/`, `scripts/`, `templates/`, `assets/` |
| `remove_file` | Remove a supporting file | path validation |
| `list` | Enumerate user skills | none |

All actions use **atomic writes** (temp file + rename) and return JSON for programmatic consumption.

### 2. `hooks/handlers/SkillNudge.ts` — Stop handler

Runs at the end of every assistant turn via `StopOrchestrator`. Reads the transcript, counts `tool_use` blocks since the most recent user-text message, and:

- **Always** appends an audit line to `~/.claude/MEMORY/STATE/skill-nudge.log`
- **If count ≥ threshold** (default 5, override via `SKILL_NUDGE_THRESHOLD`):
  - Emits a stderr hint (goes to Claude Code's internal log, not the TUI)
  - Writes a pending marker `~/.claude/MEMORY/STATE/skill-nudge-pending-<session_id>.json` with:
    - `count`, `tools` (deduped)
    - `userPrompt` — the last user-text message, truncated to 240 chars
    - `assistantText` — last assistant text block, 240 chars
    - `filesTouched` — `file_path`/`path` from Edit/Write/Read/etc. tool inputs, up to 8
    - `bashCommands` — first line of first 3 Bash commands, 120 chars each
    - `timestamp`, `session_id`

The marker is the *only* way a Stop hook can communicate with the next user turn — Claude Code's Stop hook stderr/stdout don't make it into the model's context.

### 3. `hooks/SkillNudgeInject.hook.ts` — UserPromptSubmit hook

Runs when the user submits a prompt. Reads the marker matching this session's `session_id`, renders a `<system-reminder>` on stdout (Claude Code injects UserPromptSubmit stdout into the model's context), and deletes the marker so the nudge fires exactly once.

The rendered reminder includes the captured context fields so the model can decide *on substance* whether the workflow is skill-worthy — not just on the raw count.

## Why session-scoped markers

Early versions used a global `skill-nudge-pending.json`. In parallel Claude Code sessions (common for power users — 10+ sessions open across projects), any session's UserPromptSubmit hook would consume any other session's marker, silently eating nudges. Session-scoped filenames fix this.

## Transcript parsing

The handler parses `.jsonl` transcripts directly rather than using PAI's shared `TranscriptParser` library. Reasons:

1. Keeps Caduceus free of PAI-internal dependencies — easier to vendor into other Claude Code setups.
2. Only needs a narrow subset (role + tool_use blocks), avoiding the parser's voice/tab-state logic.

Last user-text message is found by scanning the transcript backwards and skipping `user` entries whose content array contains only `tool_result` blocks (those represent the harness returning tool outputs, not a real user turn).

## Costs

- Stop handler: ~10-40ms per turn (one file read + string ops)
- UserPromptSubmit hook: ~5ms (one existsSync + read + unlink)
- Marker file: typically <2KB

Non-blocking: both hooks catch all errors and exit 0 so a handler failure never blocks a response.

## Future: background review

Hermes forks an AIAgent after each qualifying turn, feeds it the conversation + a review prompt, and lets the fork decide whether/what to save. The Claude Code equivalent is `Agent(subagent_type="general-purpose", run_in_background=true)`, invoked from a Stop-hook marker plus a UserPromptSubmit hook that checks whether the review agent produced a proposal.

This adds cost (a background inference per complex turn) but removes the model's burden of noticing the nudge. Trade-off is worth experimenting with once the MVP has proven real-world value.
