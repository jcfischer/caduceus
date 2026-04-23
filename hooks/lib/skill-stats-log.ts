#!/usr/bin/env bun
/**
 * skill-stats-log.ts - Shared emitter for caduceus usage analytics.
 *
 * Every event is one JSON object per line at
 *   ~/.claude/MEMORY/STATE/skill-stats.jsonl
 *
 * Schema (minimum fields):
 *   { ts, type, session_id?, ...event-specific }
 *
 * Event types:
 *   nudge_fired    — Stop handler detected ≥threshold tool calls
 *   nudge_injected — UserPromptSubmit surfaced a pending marker
 *   loaded         — `Skill` tool invoked
 *   created        — skill-manage create succeeded
 *   patched        — skill-manage patch succeeded
 *   deleted        — skill-manage delete succeeded
 *
 * Non-blocking: all I/O wrapped in try/catch, failures silenced so the
 * caller (hooks, CLI) never fails because of logging.
 */

import { appendFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const LOG_PATH = join(homedir(), '.claude', 'MEMORY', 'STATE', 'skill-stats.jsonl');

export type StatsEventType =
  | 'nudge_fired'
  | 'nudge_injected'
  | 'loaded'
  | 'created'
  | 'patched'
  | 'deleted';

export interface StatsEvent {
  type: StatsEventType;
  session_id?: string | null;
  skill?: string;
  count?: number;
  tools?: string[];
  file?: string;
  category?: string;
  [k: string]: unknown;
}

export function logStatsEvent(event: StatsEvent): void {
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    const line =
      JSON.stringify({
        ts: new Date().toISOString(),
        ...event,
      }) + '\n';
    appendFileSync(LOG_PATH, line);
  } catch {
    // swallow — analytics must never block the hot path
  }
}

export { LOG_PATH as STATS_LOG_PATH };
