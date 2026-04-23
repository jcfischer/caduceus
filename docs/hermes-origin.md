# Hermes origin & attribution

Caduceus is a Claude Code port of the self-improving loop from [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) (MIT licensed).

## What came from where

| Caduceus piece | Hermes source | Notes |
|----------------|---------------|-------|
| `skill-manage` CLI | `tools/skill_manager_tool.py` (795 LOC Python) | Ported as Bun/TypeScript. Subset: no `skills_guard` security scan, no `fuzzy_match` — exact match only. Actions are the same set: create/edit/patch/delete/write_file/remove_file/list. |
| `SKILLS_GUIDANCE` text in CLAUDE.md | `agent/prompt_builder.py:170` | Near-verbatim port. |
| `SkillNudge` Stop handler | `run_agent.py:11769` `_should_review_skills` check + `_skill_nudge_interval` counter | Hermes counts *iterations* (API calls); Caduceus counts raw `tool_use` blocks. Threshold 5 in Caduceus, 10 in hermes — hermes' iteration count maps to ~2 tool calls each on average. |
| Per-turn tool counter | `run_agent.py:8888-8892` `_iters_since_skill` | Hermes resets on `skill_manage` invocation; Caduceus recomputes per turn from the transcript (stateless). |
| Review prompt concept | `run_agent.py:2792-2800` `_SKILL_REVIEW_PROMPT` | Caduceus renders a similar prompt inline as a `<system-reminder>` rather than feeding it to a forked review agent. v2 roadmap: add the fork. |

## What's *not* ported (yet)

| Hermes feature | Status in Caduceus | Why skipped / plan |
|----------------|-------------------|-------------|
| Background review fork (`_spawn_background_review` at `run_agent.py:2816`) | Roadmap (#1) | Claude Code doesn't expose a runtime agent-spawning API from hooks. Needs `Agent(run_in_background=true)` from within the conversation — possible via marker files + UserPromptSubmit dispatch. |
| `skills_guard` security scanner | Roadmap (#4) | Essential if publishing to agentskills.io; deferrable for solo use. |
| `fuzzy_match` patch helper (full) | Partial — diff preview shipped in v0.3.0 | Preview-on-failure port landed as quick win; full multi-strategy matching (whitespace-insensitive, indent-flexible, block-anchor) still deferred. |
| Memory loop (`_MEMORY_REVIEW_PROMPT`, `memory_manager.py`) | Out of scope | PAI already has Tana/ai-memory integration. |
| `session_search` FTS5 cross-session recall | Out of scope | PAI has `/work` and `/w` skills for this. |

## v0.2.0 / v0.3.0 additions

| Caduceus piece | Hermes equivalent | Notes |
|----------------|-------------------|-------|
| `skill-stats` reporter + `skill-stats.jsonl` emitter | No direct hermes equivalent | Added because Luna's v2 review insisted: "you can't evaluate whether a background reviewer produces signal without baseline data on v1 nudges." Analytics shipped before autonomy. |
| `buildNotFoundPreview` + `buildMultipleMatchesPreview` in `skill-manage.ts` | `format_no_match_hint` in hermes `fuzzy_match.py` | Port of the UX fix only. Uses simple `commonPrefix` + substring containment rather than hermes' full fuzzy matcher. |

## Why "Caduceus"

The caduceus is Hermes' staff — two snakes intertwined around a winged rod. It works as the name because:

1. **Origin tribute** — Hermes Agent is the ancestor.
2. **Two loops** — the skill-manage tool (agent → skills) and the nudge pair (runtime → agent) mirror the two snakes.
3. **Carried symbol** — Hermes carried the caduceus between worlds; Caduceus carries the self-improving pattern from the Hermes runtime into the Claude Code runtime.
4. **Distinct from hermes-agent** — avoids confusion with the upstream project.

## Differences in invocation model

| | Hermes | Caduceus |
|-|--------|---------|
| Runtime | Python, own OpenAI loop | Claude Code, Anthropic harness |
| Tool invocation | Native function call registered by agent | `Bash` + Bun CLI or `Skill` tool |
| Post-turn hook | In-process callback | OS-level subprocess (`Stop` hook) |
| Counter scope | In-memory attribute on `AIAgent` | Recomputed from transcript file |
| Between-turn signalling | Shared memory object | Marker files in `MEMORY/STATE/` |

The file-based signalling is actually a feature: markers survive process restarts, are inspectable (`cat`, `jq`), and give a natural audit trail.
