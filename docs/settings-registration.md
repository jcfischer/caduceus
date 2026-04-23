# Registering Caduceus hooks in Claude Code

`install.sh` does this automatically with a backup. If you prefer to register manually, here's what to add to `~/.claude/settings.json`.

## 1. UserPromptSubmit — `SkillNudgeInject`

Add this entry to the `UserPromptSubmit` array (order doesn't matter, but placing it after any skill-enforcer hooks is cleanest):

```json
{
  "type": "command",
  "command": "${PAI_DIR}/hooks/SkillNudgeInject.hook.ts"
}
```

## 2. Stop — `SkillNudge` handler

Two integration options depending on your Stop setup:

### Option A — PAI-style orchestrator (recommended)

If you use a single `StopOrchestrator.hook.ts` that dispatches to handlers in `hooks/handlers/`, add:

```typescript
// top of file
import { handleSkillNudge } from './handlers/SkillNudge';

// in the handlers array
const handlers: Promise<void>[] = [
  // ...existing handlers
  handleSkillNudge(parsed, hookInput),
];
const handlerNames = [/* ...existing, */ 'SkillNudge'];
```

### Option B — direct Stop hook

If you want `SkillNudge` to run as its own Stop hook without an orchestrator, add to the `Stop` array in `settings.json`:

```json
{
  "hooks": [
    {
      "type": "command",
      "command": "${PAI_DIR}/hooks/handlers/SkillNudge.ts ${hook_event_name} ${transcript_path}"
    }
  ]
}
```

and wrap the handler file with a `main()` that accepts hook input on stdin. The current handler is written as a library (`handleSkillNudge(parsed, hookInput)`); a thin wrapper that reads stdin JSON and dispatches is ~10 lines.

## 3. Environment

Optional: override the threshold.

```bash
export SKILL_NUDGE_THRESHOLD=8   # default: 5
```

Goes in your shell rc so Claude Code inherits it.

## Verifying registration

After registering, run a turn with 5+ tool calls. Then check:

```bash
tail -3 ~/.claude/MEMORY/STATE/skill-nudge.log
# you should see a line with `fired=true`
```

Send another message. The model should see a `<system-reminder>` with the rich context.

## Uninstall

- Remove the two hook entries from `~/.claude/settings.json`
- Delete `~/.claude/skills/skill-manage/`
- Delete `~/.claude/hooks/SkillNudgeInject.hook.ts` and `~/.claude/hooks/handlers/SkillNudge.ts`
- Revert the orchestrator import/registration
- Remove the guidance block from `~/.claude/CLAUDE.md`
- Optionally clean up stale markers: `rm ~/.claude/MEMORY/STATE/skill-nudge-*.json ~/.claude/MEMORY/STATE/skill-nudge.log`
