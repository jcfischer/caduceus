#!/usr/bin/env bun
/**
 * skill-stats.ts — Caduceus analytics reporter.
 *
 * Reads ~/.claude/MEMORY/STATE/skill-stats.jsonl and produces readable reports.
 *
 * Usage:
 *   bun skill-stats.ts <subcommand> [--days N] [--json] [--limit N]
 *
 * Subcommands: summary, loaded, drift, unused, nudges, raw
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const STATS_LOG = join(homedir(), '.claude', 'MEMORY', 'STATE', 'skill-stats.jsonl');
const SKILLS_DIR = join(homedir(), '.claude', 'skills');

interface StatsEvent {
  ts: string;
  type: 'nudge_fired' | 'nudge_injected' | 'loaded' | 'created' | 'patched' | 'deleted';
  session_id?: string | null;
  skill?: string;
  count?: number;
  tools?: string[];
  file?: string;
  category?: string;
  [k: string]: unknown;
}

interface Flags {
  days: number;
  json: boolean;
  limit: number;
}

// ── CLI parsing ───────────────────────────────────────────────────────

function parseFlags(argv: string[]): { sub: string; flags: Flags } {
  let sub = argv[0] ?? 'summary';
  const flags: Flags = { days: 30, json: false, limit: 20 };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--days':
        flags.days = Number(next() ?? '30');
        break;
      case '--json':
        flags.json = true;
        break;
      case '--limit':
        flags.limit = Number(next() ?? '20');
        break;
    }
  }
  return { sub, flags };
}

// ── Data loading ──────────────────────────────────────────────────────

function loadEvents(days: number): StatsEvent[] {
  if (!existsSync(STATS_LOG)) return [];
  const cutoff = Date.now() - days * 86400_000;
  const events: StatsEvent[] = [];
  for (const line of readFileSync(STATS_LOG, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as StatsEvent;
      if (Date.parse(e.ts) >= cutoff) events.push(e);
    } catch {
      // skip malformed
    }
  }
  return events;
}

function listSkills(): string[] {
  if (!existsSync(SKILLS_DIR)) return [];
  const names: string[] = [];
  for (const entry of readdirSync(SKILLS_DIR)) {
    const sub = join(SKILLS_DIR, entry);
    if (!statSync(sub).isDirectory()) continue;
    if (existsSync(join(sub, 'SKILL.md'))) {
      names.push(entry);
      continue;
    }
    for (const nested of readdirSync(sub)) {
      const nsub = join(sub, nested);
      try {
        if (statSync(nsub).isDirectory() && existsSync(join(nsub, 'SKILL.md'))) names.push(nested);
      } catch {
        // skip
      }
    }
  }
  return names;
}

// ── Reports ───────────────────────────────────────────────────────────

function tally<T>(arr: T[], key: (t: T) => string | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const item of arr) {
    const k = key(item);
    if (!k) continue;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

function topN(m: Map<string, number>, n: number): Array<[string, number]> {
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function reportSummary(events: StatsEvent[], flags: Flags): void {
  const byType = tally(events, (e) => e.type);
  const loaded = events.filter((e) => e.type === 'loaded');
  const loadedTop = topN(tally(loaded, (e) => e.skill), 5);

  const fired = byType.get('nudge_fired') ?? 0;
  const injected = byType.get('nudge_injected') ?? 0;
  const created = byType.get('created') ?? 0;
  const patched = byType.get('patched') ?? 0;
  const deleted = byType.get('deleted') ?? 0;
  const saveActions = created + patched;
  const saveRate = fired > 0 ? ((saveActions / fired) * 100).toFixed(1) : '0.0';

  const installed = listSkills();
  const loadedNames = new Set(loaded.map((e) => e.skill));
  const neverLoaded = installed.filter((s) => !loadedNames.has(s));

  const patchedSkills = events.filter((e) => e.type === 'patched');
  const patchTop = topN(tally(patchedSkills, (e) => e.skill), 3);

  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          window_days: flags.days,
          total_events: events.length,
          by_type: Object.fromEntries(byType),
          nudge_funnel: { fired, injected, save_actions: saveActions, save_rate_pct: Number(saveRate) },
          top_loaded: loadedTop,
          never_loaded: neverLoaded,
          most_patched: patchTop,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`\nCaduceus analytics — last ${flags.days} days`);
  console.log('─'.repeat(40));
  console.log(`Events: ${events.length}`);
  for (const [t, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t.padEnd(16)} ${String(n).padStart(5)}`);
  }

  console.log('');
  if (fired > 0) {
    console.log(`Nudge funnel:`);
    console.log(`  ${fired} fired → ${injected} injected → ${saveActions} actions (${created} created + ${patched} patched + ${deleted} deleted)`);
    console.log(`  Save rate: ${saveRate}% of fired nudges led to a skill action`);
  } else {
    console.log(`No nudges fired in window.`);
  }

  if (loadedTop.length > 0) {
    console.log('');
    console.log(`Top ${loadedTop.length} loaded: ${loadedTop.map(([s, n]) => `${s} ×${n}`).join(', ')}`);
  }
  if (neverLoaded.length > 0) {
    const shown = neverLoaded.slice(0, 10);
    const more = neverLoaded.length > 10 ? `, +${neverLoaded.length - 10} more` : '';
    console.log(`Never loaded (${neverLoaded.length}): ${shown.join(', ')}${more}`);
  }
  if (patchTop.length > 0) {
    console.log(`Most patched: ${patchTop.map(([s, n]) => `${s} ×${n}`).join(', ')}`);
  }
  console.log('');
}

function reportLoaded(events: StatsEvent[], flags: Flags): void {
  const loaded = events.filter((e) => e.type === 'loaded');
  const top = topN(tally(loaded, (e) => e.skill), flags.limit);
  if (flags.json) {
    console.log(JSON.stringify(top.map(([skill, count]) => ({ skill, count })), null, 2));
    return;
  }
  console.log(`\nMost loaded skills — last ${flags.days} days\n`);
  if (top.length === 0) {
    console.log('  (no loaded events — SkillLoadLogger hook may not be registered)');
    return;
  }
  const maxW = Math.max(...top.map(([s]) => s.length));
  for (const [s, n] of top) console.log(`  ${s.padEnd(maxW + 2)} ${n}`);
  console.log('');
}

function reportDrift(events: StatsEvent[], flags: Flags): void {
  const patched = events.filter((e) => e.type === 'patched');
  const top = topN(tally(patched, (e) => e.skill), flags.limit);
  if (flags.json) {
    console.log(JSON.stringify(top.map(([skill, count]) => ({ skill, patches: count })), null, 2));
    return;
  }
  console.log(`\nSkill drift (most patched) — last ${flags.days} days\n`);
  if (top.length === 0) {
    console.log('  (no patches in window)');
    return;
  }
  const maxW = Math.max(...top.map(([s]) => s.length));
  for (const [s, n] of top) console.log(`  ${s.padEnd(maxW + 2)} ${n} patch${n === 1 ? '' : 'es'}`);
  console.log('');
}

function reportUnused(events: StatsEvent[], flags: Flags): void {
  const loaded = events.filter((e) => e.type === 'loaded');
  const loadedNames = new Set(loaded.map((e) => e.skill));
  const installed = listSkills();
  const unused = installed.filter((s) => !loadedNames.has(s));
  if (flags.json) {
    console.log(JSON.stringify({ installed: installed.length, unused }, null, 2));
    return;
  }
  console.log(`\nUnused skills — installed but not loaded in last ${flags.days} days\n`);
  console.log(`  ${unused.length} of ${installed.length} skills never loaded:\n`);
  for (const s of unused.slice(0, flags.limit)) console.log(`  - ${s}`);
  if (unused.length > flags.limit) console.log(`  ... +${unused.length - flags.limit} more`);
  console.log('');
}

function reportNudges(events: StatsEvent[], flags: Flags): void {
  const fired = events.filter((e) => e.type === 'nudge_fired');
  const injected = events.filter((e) => e.type === 'nudge_injected');
  const created = events.filter((e) => e.type === 'created');
  const patched = events.filter((e) => e.type === 'patched');

  const obj = {
    window_days: flags.days,
    fired: fired.length,
    injected: injected.length,
    created: created.length,
    patched: patched.length,
    save_actions: created.length + patched.length,
    save_rate_pct:
      fired.length > 0 ? Number((((created.length + patched.length) / fired.length) * 100).toFixed(1)) : 0,
    inject_rate_pct:
      fired.length > 0 ? Number(((injected.length / fired.length) * 100).toFixed(1)) : 0,
  };

  if (flags.json) {
    console.log(JSON.stringify(obj, null, 2));
    return;
  }

  console.log(`\nNudge funnel — last ${flags.days} days\n`);
  console.log(`  fired      ${obj.fired}`);
  console.log(`  injected   ${obj.injected}    (${obj.inject_rate_pct}% of fired)`);
  console.log(`  created    ${obj.created}`);
  console.log(`  patched    ${obj.patched}`);
  console.log(`  —————————————`);
  console.log(`  save rate  ${obj.save_rate_pct}%`);
  console.log('');
}

function reportRaw(events: StatsEvent[], flags: Flags): void {
  const recent = events.slice(-flags.limit);
  if (flags.json) {
    console.log(JSON.stringify(recent, null, 2));
    return;
  }
  for (const e of recent) {
    console.log(`${e.ts}  ${e.type.padEnd(16)} ${JSON.stringify({ ...e, ts: undefined, type: undefined })}`);
  }
}

// ── Dispatch ──────────────────────────────────────────────────────────

function main(): void {
  const { sub, flags } = parseFlags(process.argv.slice(2));
  const events = loadEvents(flags.days);

  switch (sub) {
    case 'summary':
      return reportSummary(events, flags);
    case 'loaded':
      return reportLoaded(events, flags);
    case 'drift':
      return reportDrift(events, flags);
    case 'unused':
      return reportUnused(events, flags);
    case 'nudges':
      return reportNudges(events, flags);
    case 'raw':
      return reportRaw(events, flags);
    default:
      console.error(`unknown subcommand: ${sub}`);
      console.error('available: summary, loaded, drift, unused, nudges, raw');
      process.exit(2);
  }
}

main();
