#!/usr/bin/env bun
/**
 * SkillNudgeInject.hook.ts - UserPromptSubmit hook that surfaces skill-save nudges.
 *
 * Paired with hooks/handlers/SkillNudge.ts (Stop handler).
 * - SkillNudge (Stop): counts tool_uses in completed turn; writes pending marker if ≥ threshold.
 * - SkillNudgeInject (UserPromptSubmit): reads marker, emits <system-reminder>,
 *   deletes marker so the nudge fires exactly once.
 *
 * TRIGGER: UserPromptSubmit
 *
 * INPUT:
 * - stdin: JSON { prompt: string, session_id?: string }
 *
 * OUTPUT:
 * - stdout: <system-reminder>...</system-reminder> when a pending nudge exists
 * - exit(0): always (non-blocking)
 *
 * MARKER FILE: ~/.claude/MEMORY/STATE/skill-nudge-pending.json
 *   { session_id, count, tools: string[], timestamp }
 *
 * Session scoping: the marker stores session_id. If the next prompt comes from
 * a different session, we still emit (and clear) — only one marker exists at a
 * time, so whoever asks next gets it. Acceptable for MVP.
 */

import { existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const PENDING_DIR = join(homedir(), '.claude', 'MEMORY', 'STATE');

function pendingPath(sessionId: string | null | undefined): string {
  const safe = (sessionId ?? 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_');
  return join(PENDING_DIR, `skill-nudge-pending-${safe}.json`);
}

interface Pending {
  session_id: string | null;
  count: number;
  tools: string[];
  userPrompt?: string;
  filesTouched?: string[];
  bashCommands?: string[];
  assistantText?: string;
  timestamp: string;
}

function truncate(s: string | undefined, n: number): string {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function formatNudge(p: Pending): string {
  const preview = p.tools.slice(0, 4).join(', ') + (p.tools.length > 4 ? ', …' : '');

  const lines: string[] = [];
  lines.push('SKILL-SAVE OPPORTUNITY');
  lines.push(`Previous turn: ${p.count} tool calls (${preview}).`);

  if (p.userPrompt) {
    lines.push('');
    lines.push(`User asked: "${truncate(p.userPrompt, 180)}"`);
  }

  if (p.assistantText) {
    lines.push(`What happened: ${truncate(p.assistantText, 180)}`);
  }

  if (p.filesTouched && p.filesTouched.length > 0) {
    lines.push(`Files touched (${p.filesTouched.length}): ${p.filesTouched.slice(0, 5).join(', ')}${p.filesTouched.length > 5 ? ', …' : ''}`);
  }

  if (p.bashCommands && p.bashCommands.length > 0) {
    lines.push(`Key commands: ${p.bashCommands.map((c) => '`' + truncate(c, 80) + '`').join(' · ')}`);
  }

  lines.push('');
  lines.push('Decide: is this a reusable workflow worth capturing as a skill?');
  lines.push('- YES → propose a name + one-sentence description, then:');
  lines.push('    bun ~/.claude/skills/skill-manage/scripts/skill-manage.ts create <name> --content <path>');
  lines.push('- Already covered by an existing skill → patch it:');
  lines.push('    bun ~/.claude/skills/skill-manage/scripts/skill-manage.ts patch <name> --old "..." --new "..."');
  lines.push('- One-off / not reusable → skip silently.');

  return `<system-reminder>\n${lines.join('\n')}\n</system-reminder>`;
}

async function main() {
  try {
    // Read session_id from stdin (Claude Code UserPromptSubmit hook input).
    const input = await Bun.stdin.text();
    let sessionId: string | null = null;
    if (input && input.trim()) {
      try {
        const parsed = JSON.parse(input);
        sessionId = parsed.session_id ?? null;
      } catch {
        // Non-JSON input — no session_id available.
      }
    }

    const markerPath = pendingPath(sessionId);
    if (!existsSync(markerPath)) {
      process.exit(0);
    }

    let pending: Pending;
    try {
      pending = JSON.parse(readFileSync(markerPath, 'utf8'));
    } catch {
      // Corrupt marker — delete and silently continue.
      rmSync(markerPath, { force: true });
      process.exit(0);
    }

    const nudge = formatNudge(pending);
    console.log(nudge);

    // Clear marker so it fires exactly once.
    rmSync(markerPath, { force: true });

    process.exit(0);
  } catch (err) {
    console.error('[SkillNudgeInject] error:', err);
    process.exit(0);
  }
}

main();
