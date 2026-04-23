#!/usr/bin/env bun
/**
 * skill-manage.ts — PAI skill CRUD helper.
 *
 * Ported minimal subset of hermes-agent/tools/skill_manager_tool.py.
 * Actions: create, edit, patch, delete, write_file, remove_file, list.
 *
 * Usage:
 *   bun skill-manage.ts <action> <name> [flags...]
 *
 * Skills live at ~/.claude/skills/<name>/ (or <category>/<name>/).
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
  statSync,
  renameSync,
} from 'fs';
import { join, dirname, resolve, relative } from 'path';
import { homedir } from 'os';
import { logStatsEvent } from '../../../hooks/lib/skill-stats-log';

const SKILLS_DIR = join(homedir(), '.claude', 'skills');
const MAX_CONTENT_BYTES = 200_000;
const NAME_RE = /^[a-z][a-z0-9-]{1,63}$/;
const CATEGORY_RE = /^[a-zA-Z0-9][a-zA-Z0-9-_]{0,63}$/;

type Result =
  | { success: true; [k: string]: unknown }
  | { success: false; error: string; [k: string]: unknown };

function out(r: Result): never {
  console.log(JSON.stringify(r));
  process.exit(r.success ? 0 : 1);
}

// ── Validation helpers ────────────────────────────────────────────────

function validateName(name: string): string | null {
  if (!name) return 'name is required';
  if (!NAME_RE.test(name))
    return `name must match ${NAME_RE} (got ${JSON.stringify(name)})`;
  return null;
}

function validateCategory(cat: string | undefined): string | null {
  if (!cat) return null;
  if (!CATEGORY_RE.test(cat))
    return `category must match ${CATEGORY_RE} (got ${JSON.stringify(cat)})`;
  return null;
}

function validateFrontmatter(content: string): string | null {
  if (!content.startsWith('---\n')) return 'SKILL.md must start with YAML frontmatter (---)';
  const end = content.indexOf('\n---', 4);
  if (end === -1) return 'SKILL.md frontmatter missing closing ---';
  const fm = content.slice(4, end);
  if (!/^name:\s*\S/m.test(fm)) return 'frontmatter missing required field: name';
  if (!/^description:\s*\S/m.test(fm)) return 'frontmatter missing required field: description';
  return null;
}

function validateSize(content: string, label = 'SKILL.md'): string | null {
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_CONTENT_BYTES)
    return `${label} too large: ${bytes}B > ${MAX_CONTENT_BYTES}B`;
  return null;
}

function validateRelPath(p: string): string | null {
  if (!p) return 'file_path is required';
  if (p.startsWith('/') || p.includes('..')) return 'file_path must be relative, no ..';
  const resolved = resolve('/skill', p);
  if (!resolved.startsWith('/skill/')) return 'file_path escapes skill dir';
  // Must be in allowed subdirs
  const allowed = ['references/', 'scripts/', 'templates/', 'assets/'];
  if (!allowed.some((a) => p.startsWith(a)))
    return `file_path must start with one of: ${allowed.join(', ')}`;
  return null;
}

// ── Skill lookup ──────────────────────────────────────────────────────

interface SkillLoc {
  path: string;
  name: string;
}

function findSkill(name: string): SkillLoc | null {
  if (!existsSync(SKILLS_DIR)) return null;
  // Flat match
  const flat = join(SKILLS_DIR, name);
  if (existsSync(join(flat, 'SKILL.md'))) return { path: flat, name };
  // Category match: one level deep
  for (const entry of readdirSync(SKILLS_DIR)) {
    const sub = join(SKILLS_DIR, entry);
    if (!statSync(sub).isDirectory()) continue;
    if (existsSync(join(sub, 'SKILL.md'))) continue; // it's itself a skill
    const nested = join(sub, name);
    if (existsSync(join(nested, 'SKILL.md'))) return { path: nested, name };
  }
  return null;
}

function resolveSkillDir(name: string, category?: string): string {
  return category ? join(SKILLS_DIR, category, name) : join(SKILLS_DIR, name);
}

// ── Atomic write ──────────────────────────────────────────────────────

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, path);
}

// ── Actions ───────────────────────────────────────────────────────────

function actionCreate(name: string, content: string, category?: string): Result {
  let err = validateName(name);
  if (err) return { success: false, error: err };
  err = validateCategory(category);
  if (err) return { success: false, error: err };
  err = validateFrontmatter(content);
  if (err) return { success: false, error: err };
  err = validateSize(content);
  if (err) return { success: false, error: err };

  if (findSkill(name))
    return { success: false, error: `skill '${name}' already exists` };

  const dir = resolveSkillDir(name, category);
  mkdirSync(dir, { recursive: true });
  const skillMd = join(dir, 'SKILL.md');
  atomicWrite(skillMd, content);

  logStatsEvent({ type: 'created', skill: name, category, session_id: process.env.CLAUDE_SESSION_ID ?? null });

  return {
    success: true,
    message: `skill '${name}' created`,
    path: relative(SKILLS_DIR, dir),
    skill_md: skillMd,
  };
}

function actionEdit(name: string, content: string): Result {
  const err = validateFrontmatter(content);
  if (err) return { success: false, error: err };
  const err2 = validateSize(content);
  if (err2) return { success: false, error: err2 };
  const loc = findSkill(name);
  if (!loc) return { success: false, error: `skill '${name}' not found` };
  atomicWrite(join(loc.path, 'SKILL.md'), content);
  return { success: true, message: `skill '${name}' updated` };
}

function actionPatch(
  name: string,
  oldStr: string,
  newStr: string,
  filePath?: string,
  replaceAll = false,
): Result {
  if (!oldStr) return { success: false, error: 'old is required' };
  const loc = findSkill(name);
  if (!loc) return { success: false, error: `skill '${name}' not found` };

  let target: string;
  if (filePath) {
    const err = validateRelPath(filePath);
    if (err) return { success: false, error: err };
    target = join(loc.path, filePath);
  } else {
    target = join(loc.path, 'SKILL.md');
  }
  if (!existsSync(target))
    return { success: false, error: `file not found: ${relative(loc.path, target)}` };

  const content = readFileSync(target, 'utf8');
  let newContent: string;
  let count = 0;
  if (replaceAll) {
    newContent = content.split(oldStr).join(newStr);
    count = content.split(oldStr).length - 1;
  } else {
    const idx = content.indexOf(oldStr);
    if (idx === -1) return { success: false, error: `old string not found in ${relative(loc.path, target)}` };
    const next = content.indexOf(oldStr, idx + oldStr.length);
    if (next !== -1)
      return {
        success: false,
        error: `old string matched multiple times in ${relative(loc.path, target)}; pass --replace-all to replace all, or provide more unique context`,
      };
    newContent = content.slice(0, idx) + newStr + content.slice(idx + oldStr.length);
    count = 1;
  }

  const label = filePath ?? 'SKILL.md';
  const err = validateSize(newContent, label);
  if (err) return { success: false, error: err };

  if (!filePath) {
    const fmErr = validateFrontmatter(newContent);
    if (fmErr) return { success: false, error: `patch would break frontmatter: ${fmErr}` };
  }

  atomicWrite(target, newContent);
  logStatsEvent({ type: 'patched', skill: name, file: label, session_id: process.env.CLAUDE_SESSION_ID ?? null });
  return { success: true, message: `skill '${name}' patched (${count} replacement${count === 1 ? '' : 's'})`, file: label };
}

function actionDelete(name: string): Result {
  const loc = findSkill(name);
  if (!loc) return { success: false, error: `skill '${name}' not found` };
  rmSync(loc.path, { recursive: true, force: true });
  logStatsEvent({ type: 'deleted', skill: name, session_id: process.env.CLAUDE_SESSION_ID ?? null });
  return { success: true, message: `skill '${name}' deleted`, path: relative(SKILLS_DIR, loc.path) };
}

function actionWriteFile(name: string, filePath: string, content: string): Result {
  const loc = findSkill(name);
  if (!loc) return { success: false, error: `skill '${name}' not found. create it first.` };
  const err = validateRelPath(filePath);
  if (err) return { success: false, error: err };
  const err2 = validateSize(content, filePath);
  if (err2) return { success: false, error: err2 };
  const target = join(loc.path, filePath);
  atomicWrite(target, content);
  return { success: true, message: `wrote ${filePath} to skill '${name}'`, path: target };
}

function actionRemoveFile(name: string, filePath: string): Result {
  const loc = findSkill(name);
  if (!loc) return { success: false, error: `skill '${name}' not found` };
  const err = validateRelPath(filePath);
  if (err) return { success: false, error: err };
  const target = join(loc.path, filePath);
  if (!existsSync(target))
    return { success: false, error: `file not found: ${filePath}` };
  rmSync(target, { force: true });
  return { success: true, message: `removed ${filePath} from skill '${name}'` };
}

function actionList(): Result {
  if (!existsSync(SKILLS_DIR)) return { success: true, skills: [] };
  const skills: { name: string; path: string; category?: string }[] = [];
  for (const entry of readdirSync(SKILLS_DIR)) {
    const sub = join(SKILLS_DIR, entry);
    if (!statSync(sub).isDirectory()) continue;
    if (existsSync(join(sub, 'SKILL.md'))) {
      skills.push({ name: entry, path: relative(SKILLS_DIR, sub) });
      continue;
    }
    for (const nested of readdirSync(sub)) {
      const nsub = join(sub, nested);
      if (!statSync(nsub).isDirectory()) continue;
      if (existsSync(join(nsub, 'SKILL.md')))
        skills.push({ name: nested, path: relative(SKILLS_DIR, nsub), category: entry });
    }
  }
  return { success: true, skills, count: skills.length };
}

// ── CLI parse ─────────────────────────────────────────────────────────

interface Flags {
  content?: string;
  stdin?: boolean;
  category?: string;
  old?: string;
  new?: string;
  file?: string;
  replaceAll?: boolean;
}

function parseFlags(argv: string[]): Flags {
  const f: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--content': f.content = next(); break;
      case '--stdin': f.stdin = true; break;
      case '--category': f.category = next(); break;
      case '--old': f.old = next(); break;
      case '--new': f.new = next(); break;
      case '--file': f.file = next(); break;
      case '--replace-all': f.replaceAll = true; break;
      default:
        if (a.startsWith('--')) {
          console.error(`unknown flag: ${a}`);
          process.exit(2);
        }
    }
  }
  return f;
}

async function readStdin(): Promise<string> {
  return await Bun.stdin.text();
}

async function readContent(flags: Flags): Promise<string> {
  if (flags.stdin) return await readStdin();
  if (!flags.content) {
    console.error('--content <path> or --stdin required');
    process.exit(2);
  }
  return readFileSync(flags.content, 'utf8');
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  const [action, ...rest] = process.argv.slice(2);
  if (!action) {
    console.error(
      'usage: skill-manage.ts <action> [name] [flags]\n  actions: create edit patch delete write_file remove_file list',
    );
    process.exit(2);
  }

  if (action === 'list') out(actionList());

  const name = rest[0];
  const flagArgs = rest.slice(1);
  const flags = parseFlags(flagArgs);

  switch (action) {
    case 'create': {
      const content = await readContent(flags);
      out(actionCreate(name, content, flags.category));
    }
    case 'edit': {
      const content = await readContent(flags);
      out(actionEdit(name, content));
    }
    case 'patch':
      out(actionPatch(name, flags.old ?? '', flags.new ?? '', flags.file, flags.replaceAll));
    case 'delete':
      out(actionDelete(name));
    case 'write_file': {
      const filePath = rest[1];
      const cFlags = parseFlags(rest.slice(2));
      const content = await readContent(cFlags);
      out(actionWriteFile(name, filePath, content));
    }
    case 'remove_file': {
      const filePath = rest[1];
      out(actionRemoveFile(name, filePath));
    }
    default:
      console.error(`unknown action: ${action}`);
      process.exit(2);
  }
}

main();
