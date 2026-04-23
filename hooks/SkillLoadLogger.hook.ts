#!/usr/bin/env bun
/**
 * SkillLoadLogger.hook.ts - PreToolUse hook for the Skill tool.
 *
 * Records a `loaded` event every time Claude invokes the Skill tool.
 * Feeds skill-stats analytics so we can see which skills actually get used
 * vs which are dead weight in ~/.claude/skills/.
 *
 * TRIGGER: PreToolUse, matcher: Skill
 *
 * INPUT: stdin JSON { session_id, tool_name, tool_input: { skill?: string, args?: string } }
 * OUTPUT: nothing (non-blocking, exit 0)
 */

import { logStatsEvent } from './lib/skill-stats-log';

async function main() {
  try {
    const input = await Bun.stdin.text();
    if (!input || !input.trim()) process.exit(0);

    let parsed: { session_id?: string; tool_input?: { skill?: string; args?: string } };
    try {
      parsed = JSON.parse(input);
    } catch {
      process.exit(0);
    }

    const skill = parsed?.tool_input?.skill;
    if (!skill) process.exit(0);

    logStatsEvent({
      type: 'loaded',
      session_id: parsed.session_id ?? null,
      skill,
      args: parsed.tool_input?.args ?? undefined,
    });

    process.exit(0);
  } catch {
    process.exit(0);
  }
}

main();
