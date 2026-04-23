---
name: skill-stats
description: Caduceus usage analytics — which skills actually get loaded, how often they get patched, and whether the nudge loop produces useful saves. Use when you want to know if caduceus is helping, or to audit dead-weight skills.
triggers:
  - skill-stats
  - skill stats
  - skill analytics
  - skill usage
  - caduceus stats
  - are my skills working
---

# skill-stats

Reporter for the caduceus analytics feed. Every event goes into
`~/.claude/MEMORY/STATE/skill-stats.jsonl` (one JSON object per line) and this skill surfaces the signal.

## When to Use

- Weekly review: "are my skills pulling their weight?"
- After a week of caduceus v1: is the nudge loop producing saves, and are those saves being reloaded?
- Auditing `~/.claude/skills/` for dead weight — never-loaded skills that could be deleted
- Evaluating drift: skills that get patched a lot are either evolving usefully or fighting their own spec

## CLI

```bash
bun ~/.claude/skills/skill-stats/scripts/skill-stats.ts <subcommand> [options]
```

### Subcommands

| Subcommand | Purpose |
|-----------|---------|
| `summary` | Overall health: event counts + nudge→save funnel (default) |
| `loaded` | Ranked list of most-loaded skills + never-loaded skills |
| `drift` | Skills ranked by patch frequency |
| `unused` | Skills that exist in `~/.claude/skills/` but have no `loaded` event |
| `nudges` | Nudge→save funnel: fired → injected → created/patched |
| `raw` | Dump recent events as JSON |

### Options

- `--days N` — window (default: 30)
- `--json` — machine-readable output
- `--limit N` — cap row count (default: 20)

## Example

```
$ skill-stats summary

Caduceus analytics — last 30 days
──────────────────────────────────
Events: 2847
  loaded         1923   (most invoked: Research ×312, calendar ×218, weekly-timesheet-review ×47)
  nudge_fired     412
  nudge_injected  398   (94% of fired — some missed due to session scoping)
  created           6
  patched           4
  deleted           1

Nudge funnel:
  412 fired → 398 injected → 10 actions (6 created + 4 patched) = 2.5% save rate

Top 5 loaded:     Research, calendar, email, Thinking, weekly-timesheet-review
Never loaded (7): AlexHormoziPitch, Sales, WriteStory, USMetrics, Discord, demo-skill, tana-slide-deck
Most patched:     weekly-timesheet-review (2x — in first week)
```

## Interpretation guide

- **Low nudge→save rate (<5%)** — either threshold too aggressive (lower `SKILL_NUDGE_THRESHOLD`) or genuine signal that most turns aren't skill-worthy. Good.
- **High patch rate right after create** — skill was shipped incomplete. Caduceus working as intended.
- **Never-loaded >30% of skills** — skill description/triggers are not matching actual prompts. Rewrite `description:` frontmatter or delete.
- **High `loaded` no patches** — skill is stable. Don't touch.

## Events logged

```
nudge_fired    { count, tools, session_id }
nudge_injected { count, tools, session_id }   — one per marker consumption
loaded         { skill, args?, session_id }
created        { skill, category?, session_id }
patched        { skill, file, session_id }
deleted        { skill, session_id }
```

## Pitfalls

- `loaded` events depend on PreToolUse on `Skill` matcher. If the hook isn't registered, reports will show no `loaded` rows but events from skill-manage will still land.
- The `unused` report enumerates `~/.claude/skills/` — skills installed after the analytics log started that never get loaded. For old skills that pre-exist the log, absence doesn't mean dead weight — only means not loaded in the analytics window.
- Events from multiple parallel sessions interleave in the single jsonl — use `--days` to window, or filter by session_id in `raw` output.

## Related

- `skill-manage` — CRUD tool that emits created/patched/deleted events
- `hooks/handlers/SkillNudge.ts` — emits nudge_fired
- `hooks/SkillNudgeInject.hook.ts` — emits nudge_injected
- `hooks/SkillLoadLogger.hook.ts` — emits loaded
