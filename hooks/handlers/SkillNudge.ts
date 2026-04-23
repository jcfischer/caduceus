#!/usr/bin/env bun
/**
 * SkillNudge.ts - Stop-handler that nudges skill creation after complex turns.
 *
 * Ported behavior from hermes-agent/run_agent.py:11769 (_skill_nudge_interval).
 *
 * TRIGGER: Stop event (via StopOrchestrator)
 *
 * BEHAVIOR:
 * - Reads transcript, counts tool_use blocks in the most recent assistant turn
 *   (since the last user message).
 * - If count >= threshold (default 5), emits a stderr nudge. Hermes uses 10 for
 *   its iteration-based counter; we use 5 because PAI counts raw tool_use
 *   blocks rather than iterations (one iteration in hermes can contain several
 *   parallel tool calls — the SKILLS_GUIDANCE advisory text also says "5+").
 *
 * RATIONALE (MVP):
 * - No subagent fork (v2). Just surfaces the count so the user knows a skill
 *   could be saved. Model picks up the hint via CLAUDE.md SKILLS_GUIDANCE on
 *   the next turn if the user follows through.
 *
 * NON-BLOCKING: Never fails a response. Catches all errors.
 */

import { readFileSync, existsSync, appendFileSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { logStatsEvent } from '../lib/skill-stats-log';

const LOG_PATH = join(homedir(), '.claude', 'MEMORY', 'STATE', 'skill-nudge.log');
const PENDING_DIR = join(homedir(), '.claude', 'MEMORY', 'STATE');

function pendingPath(sessionId: string | null | undefined): string {
  const safe = (sessionId ?? 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_');
  return join(PENDING_DIR, `skill-nudge-pending-${safe}.json`);
}

const THRESHOLD = Number(process.env.SKILL_NUDGE_THRESHOLD ?? 5);

interface TranscriptEntry {
  type?: string;
  message?: {
    role?: string;
    content?: Array<{ type?: string; name?: string; input?: Record<string, unknown>; text?: string }> | string;
  };
}

export interface TurnSummary {
  count: number;
  toolNames: string[];
  userPrompt: string;
  filesTouched: string[];
  bashCommands: string[];
  assistantText: string;
}

function extractString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Walk transcript and summarise the most recent assistant turn since the last user-text message. */
export function summariseLastTurn(transcriptPath: string): TurnSummary {
  const empty: TurnSummary = {
    count: 0,
    toolNames: [],
    userPrompt: '',
    filesTouched: [],
    bashCommands: [],
    assistantText: '',
  };
  if (!existsSync(transcriptPath)) return empty;

  let raw: string;
  try {
    raw = readFileSync(transcriptPath, 'utf8');
  } catch {
    return empty;
  }

  const entries: TranscriptEntry[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // ignore malformed
    }
  }

  // Find the most recent user-text message.
  let lastUserIdx = -1;
  let userPrompt = '';
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e?.message?.role !== 'user') continue;
    const content = e.message.content;
    if (typeof content === 'string') {
      lastUserIdx = i;
      userPrompt = content;
      break;
    }
    if (Array.isArray(content)) {
      const textBlock = content.find((b) => b?.type === 'text');
      if (!textBlock) continue;
      lastUserIdx = i;
      userPrompt = extractString(textBlock.text);
      break;
    }
  }

  const toolNames: string[] = [];
  const filesTouched = new Set<string>();
  const bashCommands: string[] = [];
  let assistantText = '';

  for (let i = lastUserIdx + 1; i < entries.length; i++) {
    const e = entries[i];
    if (e?.message?.role !== 'assistant') continue;
    const content = e.message.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block?.type === 'tool_use' && block.name) {
        toolNames.push(block.name);
        const input = (block.input ?? {}) as Record<string, unknown>;
        const fp = extractString(input.file_path ?? input.path ?? input.filePath);
        if (fp) filesTouched.add(fp);
        if (block.name === 'Bash') {
          const cmd = extractString(input.command);
          if (cmd) bashCommands.push(cmd.split('\n')[0].slice(0, 120));
        }
      } else if (block?.type === 'text' && block.text) {
        assistantText = block.text; // keep the last one
      }
    }
  }

  return {
    count: toolNames.length,
    toolNames,
    userPrompt: userPrompt.replace(/\s+/g, ' ').trim().slice(0, 240),
    filesTouched: [...filesTouched].slice(0, 8),
    bashCommands: bashCommands.slice(0, 3),
    assistantText: assistantText.replace(/\s+/g, ' ').trim().slice(0, 240),
  };
}

/** Back-compat wrapper used by older callers/tests. */
export function countToolUsesInLastTurn(transcriptPath: string): {
  count: number;
  toolNames: string[];
} {
  const s = summariseLastTurn(transcriptPath);
  return { count: s.count, toolNames: s.toolNames };
}

export async function handleSkillNudge(
  _parsed: unknown,
  hookInput: { transcript_path?: string; session_id?: string },
): Promise<void> {
  try {
    const path = hookInput.transcript_path;
    if (!path) return;
    const summary = summariseLastTurn(path);
    const { count, toolNames } = summary;
    // Always log for audit (whether nudge fires or not).
    try {
      mkdirSync(dirname(LOG_PATH), { recursive: true });
      const ts = new Date().toISOString();
      const fired = count >= THRESHOLD;
      appendFileSync(
        LOG_PATH,
        `${ts}\tsession=${hookInput.session_id ?? '?'}\tcount=${count}\tthreshold=${THRESHOLD}\tfired=${fired}\ttools=${toolNames.join(',')}\n`,
      );
    } catch {
      // ignore log failures
    }

    if (count < THRESHOLD) return;

    // Dedup + top tools preview
    const unique = [...new Set(toolNames)];
    const preview = unique.slice(0, 4).join(', ') + (unique.length > 4 ? ', …' : '');

    process.stderr.write(
      `\n💡 [SkillNudge] ${count} tool calls this turn (${preview}). ` +
        `Consider saving the approach: Skill('skill-manage') → create.\n`,
    );

    logStatsEvent({
      type: 'nudge_fired',
      session_id: hookInput.session_id ?? null,
      count,
      tools: unique,
    });

    // Write pending marker (per-session) so SkillNudgeInject (UserPromptSubmit)
    // can surface the nudge into the model's context on the NEXT user turn.
    try {
      writeFileSync(
        pendingPath(hookInput.session_id),
        JSON.stringify(
          {
            session_id: hookInput.session_id ?? null,
            count,
            tools: unique,
            userPrompt: summary.userPrompt,
            filesTouched: summary.filesTouched,
            bashCommands: summary.bashCommands,
            assistantText: summary.assistantText,
            timestamp: new Date().toISOString(),
          },
          null,
          2,
        ),
      );
    } catch {
      // ignore — best-effort
    }
  } catch (e) {
    // Never block Stop event
  }
}

// Entry point for both:
//   (a) Direct Stop-hook registration (arc-manifest hooks mapping) — reads
//       Claude Code hook input JSON on stdin and dispatches handleSkillNudge.
//   (b) Manual CLI debugging — pass a transcript path as argv[2] and get a
//       JSON summary.
//
// PAI orchestrator users import `handleSkillNudge` directly — this branch does
// not run in that case (import.meta.main is false when imported).
if (import.meta.main) {
  const argvPath = process.argv[2];
  if (argvPath) {
    // CLI debug mode
    const { count, toolNames } = countToolUsesInLastTurn(argvPath);
    console.log(JSON.stringify({ count, toolNames, threshold: THRESHOLD, would_nudge: count >= THRESHOLD }, null, 2));
  } else {
    // Stop-hook mode: read hook input from stdin.
    const raw = await Bun.stdin.text();
    let hookInput: { transcript_path?: string; session_id?: string } = {};
    try {
      if (raw.trim()) hookInput = JSON.parse(raw);
    } catch {
      process.exit(0);
    }
    await handleSkillNudge(null, hookInput);
    process.exit(0);
  }
}
