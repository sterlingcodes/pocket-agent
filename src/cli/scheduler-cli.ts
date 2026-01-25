#!/usr/bin/env node
/**
 * CLI for Scheduler Management
 *
 * Supports three schedule types:
 * - cron: Standard cron expression (e.g., "0 9 * * *")
 * - at: One-time execution at specific time (e.g., "tomorrow 3pm")
 * - every: Recurring interval (e.g., "30m", "2h", "1d")
 *
 * Usage:
 *   node dist/cli/scheduler-cli.js add <name> <schedule> <prompt> [options]
 *   node dist/cli/scheduler-cli.js list
 *   node dist/cli/scheduler-cli.js delete <name>
 *   node dist/cli/scheduler-cli.js run <name>
 *   node dist/cli/scheduler-cli.js status
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

function getDbPath(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || '';
  const possiblePaths = [
    path.join(homeDir, 'Library/Application Support/pocket-agent/pocket-agent.db'),
    path.join(homeDir, '.config/pocket-agent/pocket-agent.db'),
    path.join(homeDir, 'AppData/Roaming/pocket-agent/pocket-agent.db'),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return possiblePaths[0];
}

// Parse schedule string and determine type
function parseSchedule(input: string): {
  type: 'cron' | 'at' | 'every';
  schedule?: string;
  runAt?: string;
  intervalMs?: number;
} | null {
  const trimmed = input.trim();

  // Check for "every" pattern: 30m, 2h, 1d, etc.
  const everyMatch = trimmed.match(/^(?:every\s+)?(\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)$/i);
  if (everyMatch) {
    const [, amount, unit] = everyMatch;
    const num = parseInt(amount, 10);
    let ms: number;
    if (unit.startsWith('m')) ms = num * 60 * 1000;
    else if (unit.startsWith('h')) ms = num * 60 * 60 * 1000;
    else ms = num * 24 * 60 * 60 * 1000;
    return { type: 'every', intervalMs: ms };
  }

  // Check for "at" pattern: specific datetime
  const atTime = parseDateTime(trimmed);
  if (atTime) {
    // If it's a relative/specific time, treat as "at"
    if (trimmed.match(/^(today|tomorrow|in\s+\d|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i)) {
      return { type: 'at', runAt: atTime };
    }
  }

  // Check for cron expression (5 parts)
  const parts = trimmed.split(/\s+/);
  if (parts.length === 5 && validateCron(trimmed)) {
    return { type: 'cron', schedule: trimmed };
  }

  // Try parsing as datetime for "at" type
  if (atTime) {
    return { type: 'at', runAt: atTime };
  }

  return null;
}

// Parse datetime string to ISO format
function parseDateTime(input: string): string | null {
  const now = new Date();

  // "today 3pm", "tomorrow 9am", "monday 2pm"
  const relativeMatch = input.match(/^(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (relativeMatch) {
    const [, dayStr, hourStr, minStr, ampm] = relativeMatch;
    const targetDate = new Date(now);

    if (dayStr.toLowerCase() === 'tomorrow') {
      targetDate.setDate(targetDate.getDate() + 1);
    } else if (dayStr.toLowerCase() !== 'today') {
      const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
      const targetDay = days.indexOf(dayStr.toLowerCase());
      const currentDay = targetDate.getDay();
      let daysToAdd = targetDay - currentDay;
      if (daysToAdd <= 0) daysToAdd += 7;
      targetDate.setDate(targetDate.getDate() + daysToAdd);
    }

    let hour = parseInt(hourStr, 10);
    const min = minStr ? parseInt(minStr, 10) : 0;
    if (ampm?.toLowerCase() === 'pm' && hour < 12) hour += 12;
    if (ampm?.toLowerCase() === 'am' && hour === 12) hour = 0;

    targetDate.setHours(hour, min, 0, 0);
    return targetDate.toISOString();
  }

  // "in 2 hours", "in 30 minutes", "in 3 days"
  const inMatch = input.match(/^in\s+(\d+)\s*(hour|hr|minute|min|day|d)s?$/i);
  if (inMatch) {
    const [, amount, unit] = inMatch;
    const num = parseInt(amount, 10);
    let ms: number;
    if (unit.toLowerCase().startsWith('hour') || unit.toLowerCase() === 'hr') {
      ms = num * 3600000;
    } else if (unit.toLowerCase().startsWith('min')) {
      ms = num * 60000;
    } else {
      ms = num * 86400000;
    }
    return new Date(now.getTime() + ms).toISOString();
  }

  // Try direct parse (ISO format, etc.)
  const parsed = new Date(input);
  if (!isNaN(parsed.getTime()) && parsed > now) {
    return parsed.toISOString();
  }

  return null;
}

// Validate cron expression
function validateCron(schedule: string): boolean {
  const parts = schedule.split(/\s+/);
  if (parts.length !== 5) return false;

  const ranges = [
    [0, 59],  // minute
    [0, 23],  // hour
    [1, 31],  // day
    [1, 12],  // month
    [0, 7],   // weekday
  ];

  for (let i = 0; i < 5; i++) {
    const part = parts[i];
    if (part === '*') continue;
    if (part.includes('/')) continue;
    if (part.includes('-')) continue;
    if (part.includes(',')) continue;

    const num = parseInt(part, 10);
    if (isNaN(num) || num < ranges[i][0] || num > ranges[i][1]) {
      return false;
    }
  }

  return true;
}

// Calculate next run time
function calculateNextRun(type: string, schedule: string | null, runAt: string | null, intervalMs: number | null): string | null {
  const now = new Date();

  if (type === 'at' && runAt) {
    const runDate = new Date(runAt);
    return runDate > now ? runAt : null;
  }

  if (type === 'every' && intervalMs) {
    return new Date(now.getTime() + intervalMs).toISOString();
  }

  if (type === 'cron' && schedule) {
    // Simple next cron calculation (for common patterns)
    const parts = schedule.split(/\s+/);
    const [min, hour] = parts;

    const next = new Date(now);
    next.setSeconds(0, 0);

    if (min !== '*') next.setMinutes(parseInt(min, 10));
    if (hour !== '*') next.setHours(parseInt(hour, 10));

    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }

    return next.toISOString();
  }

  return null;
}

function formatDateTime(isoString: string | null): string | null {
  if (!isoString) return null;
  const date = new Date(isoString);
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDuration(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  if (ms < 86400000) return `${Math.round(ms / 3600000)}h`;
  return `${Math.round(ms / 86400000)}d`;
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    console.log(JSON.stringify({
      error: 'Usage: scheduler-cli <add|list|delete|run|status> [args]',
      commands: {
        add: 'scheduler-cli add <name> "<schedule>" "<prompt>" [--delete-after] [--context <n>] [--channel <channel>]',
        list: 'scheduler-cli list',
        delete: 'scheduler-cli delete <name>',
        run: 'scheduler-cli run <name>',
        status: 'scheduler-cli status',
      },
      scheduleTypes: {
        cron: '"0 9 * * *" (daily 9am), "*/30 * * * *" (every 30 min)',
        at: '"tomorrow 3pm", "in 2 hours", "monday 9am"',
        every: '"30m", "2h", "1d" (recurring interval)',
      },
    }));
    process.exit(1);
  }

  const dbPath = getDbPath();
  if (!fs.existsSync(dbPath)) {
    console.log(JSON.stringify({ error: 'Database not found. Please start Pocket Agent first.' }));
    process.exit(1);
  }

  const db = new Database(dbPath);

  // Ensure table exists with new schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS cron_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      schedule_type TEXT NOT NULL DEFAULT 'cron' CHECK(schedule_type IN ('cron', 'at', 'every')),
      schedule TEXT,
      run_at TEXT,
      interval_ms INTEGER,
      prompt TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'desktop',
      enabled INTEGER DEFAULT 1,
      delete_after_run INTEGER DEFAULT 0,
      context_messages INTEGER DEFAULT 0,
      next_run_at TEXT,
      last_run_at TEXT,
      last_status TEXT CHECK(last_status IN ('ok', 'error', 'skipped')),
      last_error TEXT,
      last_duration_ms INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Migration for existing tables (add new columns if they don't exist)
  try {
    db.exec(`ALTER TABLE cron_jobs ADD COLUMN schedule_type TEXT DEFAULT 'cron'`);
  } catch { /* column exists */ }
  try {
    db.exec(`ALTER TABLE cron_jobs ADD COLUMN run_at TEXT`);
  } catch { /* column exists */ }
  try {
    db.exec(`ALTER TABLE cron_jobs ADD COLUMN interval_ms INTEGER`);
  } catch { /* column exists */ }
  try {
    db.exec(`ALTER TABLE cron_jobs ADD COLUMN delete_after_run INTEGER DEFAULT 0`);
  } catch { /* column exists */ }
  try {
    db.exec(`ALTER TABLE cron_jobs ADD COLUMN context_messages INTEGER DEFAULT 0`);
  } catch { /* column exists */ }
  try {
    db.exec(`ALTER TABLE cron_jobs ADD COLUMN next_run_at TEXT`);
  } catch { /* column exists */ }
  try {
    db.exec(`ALTER TABLE cron_jobs ADD COLUMN last_run_at TEXT`);
  } catch { /* column exists */ }
  try {
    db.exec(`ALTER TABLE cron_jobs ADD COLUMN last_status TEXT`);
  } catch { /* column exists */ }
  try {
    db.exec(`ALTER TABLE cron_jobs ADD COLUMN last_error TEXT`);
  } catch { /* column exists */ }
  try {
    db.exec(`ALTER TABLE cron_jobs ADD COLUMN last_duration_ms INTEGER`);
  } catch { /* column exists */ }
  try {
    db.exec(`ALTER TABLE cron_jobs ADD COLUMN created_at TEXT DEFAULT (datetime('now'))`);
  } catch { /* column exists */ }
  try {
    db.exec(`ALTER TABLE cron_jobs ADD COLUMN updated_at TEXT DEFAULT (datetime('now'))`);
  } catch { /* column exists */ }

  try {
    switch (command) {
      case 'add': {
        const [, name, scheduleStr, prompt] = args;

        if (!name || !scheduleStr || !prompt) {
          console.log(JSON.stringify({ error: 'Usage: add <name> "<schedule>" "<prompt>" [options]' }));
          process.exit(1);
        }

        const parsed = parseSchedule(scheduleStr);
        if (!parsed) {
          console.log(JSON.stringify({
            error: `Could not parse schedule: "${scheduleStr}"`,
            hint: 'Use cron ("0 9 * * *"), at ("tomorrow 3pm"), or every ("30m")',
          }));
          process.exit(1);
        }

        // Parse options
        let deleteAfterRun = 0;
        let contextMessages = 0;
        let channel = 'desktop';

        for (let i = 4; i < args.length; i++) {
          if (args[i] === '--delete-after') {
            deleteAfterRun = 1;
          } else if (args[i] === '--context' && args[i + 1]) {
            contextMessages = Math.min(10, Math.max(0, parseInt(args[++i], 10)));
          } else if (args[i] === '--channel' && args[i + 1]) {
            channel = args[++i];
          }
        }

        // Auto-enable delete-after for one-time "at" jobs
        if (parsed.type === 'at') {
          deleteAfterRun = 1;
        }

        const nextRunAt = calculateNextRun(
          parsed.type,
          parsed.schedule || null,
          parsed.runAt || null,
          parsed.intervalMs || null
        );

        // Check if exists
        const existing = db.prepare('SELECT id FROM cron_jobs WHERE name = ?').get(name);

        if (existing) {
          db.prepare(`
            UPDATE cron_jobs SET
              schedule_type = ?, schedule = ?, run_at = ?, interval_ms = ?,
              prompt = ?, channel = ?, enabled = 1,
              delete_after_run = ?, context_messages = ?, next_run_at = ?,
              updated_at = datetime('now')
            WHERE name = ?
          `).run(
            parsed.type, parsed.schedule || null, parsed.runAt || null, parsed.intervalMs || null,
            prompt, channel, deleteAfterRun, contextMessages, nextRunAt, name
          );
          console.log(JSON.stringify({
            success: true,
            action: 'updated',
            name,
            type: parsed.type,
            next_run: formatDateTime(nextRunAt),
            delete_after_run: deleteAfterRun === 1,
          }));
        } else {
          db.prepare(`
            INSERT INTO cron_jobs (
              name, schedule_type, schedule, run_at, interval_ms,
              prompt, channel, enabled, delete_after_run, context_messages, next_run_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
          `).run(
            name, parsed.type, parsed.schedule || null, parsed.runAt || null, parsed.intervalMs || null,
            prompt, channel, deleteAfterRun, contextMessages, nextRunAt
          );
          console.log(JSON.stringify({
            success: true,
            action: 'created',
            name,
            type: parsed.type,
            next_run: formatDateTime(nextRunAt),
            delete_after_run: deleteAfterRun === 1,
          }));
        }
        break;
      }

      case 'list': {
        const jobs = db.prepare(`
          SELECT name, schedule_type, schedule, run_at, interval_ms, prompt, channel, enabled,
                 delete_after_run, next_run_at, last_run_at, last_status, last_duration_ms
          FROM cron_jobs ORDER BY next_run_at ASC NULLS LAST
        `).all() as Array<{
          name: string;
          schedule_type: string;
          schedule: string | null;
          run_at: string | null;
          interval_ms: number | null;
          prompt: string;
          channel: string;
          enabled: number;
          delete_after_run: number;
          next_run_at: string | null;
          last_run_at: string | null;
          last_status: string | null;
          last_duration_ms: number | null;
        }>;

        console.log(JSON.stringify({
          success: true,
          count: jobs.length,
          jobs: jobs.map(j => ({
            name: j.name,
            type: j.schedule_type || 'cron',
            schedule: j.schedule_type === 'every'
              ? `every ${formatDuration(j.interval_ms || 0)}`
              : j.schedule_type === 'at'
              ? formatDateTime(j.run_at)
              : j.schedule,
            prompt: j.prompt.length > 60 ? j.prompt.slice(0, 60) + '...' : j.prompt,
            channel: j.channel,
            enabled: j.enabled === 1,
            one_time: j.delete_after_run === 1,
            next_run: formatDateTime(j.next_run_at),
            last_run: j.last_run_at ? {
              at: formatDateTime(j.last_run_at),
              status: j.last_status,
              duration: j.last_duration_ms ? formatDuration(j.last_duration_ms) : null,
            } : null,
          })),
        }));
        break;
      }

      case 'delete': {
        const [, name] = args;
        if (!name) {
          console.log(JSON.stringify({ error: 'Usage: delete <name>' }));
          process.exit(1);
        }

        const result = db.prepare('DELETE FROM cron_jobs WHERE name = ?').run(name);
        if (result.changes > 0) {
          console.log(JSON.stringify({ success: true, message: `Job "${name}" deleted` }));
        } else {
          console.log(JSON.stringify({ success: false, error: `Job "${name}" not found` }));
        }
        break;
      }

      case 'run': {
        const [, name] = args;
        if (!name) {
          console.log(JSON.stringify({ error: 'Usage: run <name>' }));
          process.exit(1);
        }

        const job = db.prepare('SELECT * FROM cron_jobs WHERE name = ?').get(name);
        if (!job) {
          console.log(JSON.stringify({ success: false, error: `Job "${name}" not found` }));
          process.exit(1);
        }

        // Mark as running (scheduler will pick this up)
        db.prepare(`UPDATE cron_jobs SET next_run_at = datetime('now') WHERE name = ?`).run(name);
        console.log(JSON.stringify({ success: true, message: `Job "${name}" queued for immediate execution` }));
        break;
      }

      case 'status': {
        const stats = db.prepare(`
          SELECT
            COUNT(*) as total,
            SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as active,
            SUM(CASE WHEN last_status = 'ok' THEN 1 ELSE 0 END) as succeeded,
            SUM(CASE WHEN last_status = 'error' THEN 1 ELSE 0 END) as failed
          FROM cron_jobs
        `).get() as { total: number; active: number; succeeded: number; failed: number };

        const nextJob = db.prepare(`
          SELECT name, next_run_at FROM cron_jobs
          WHERE enabled = 1 AND next_run_at IS NOT NULL
          ORDER BY next_run_at ASC LIMIT 1
        `).get() as { name: string; next_run_at: string } | undefined;

        console.log(JSON.stringify({
          success: true,
          jobs: {
            total: stats.total,
            active: stats.active,
            succeeded: stats.succeeded || 0,
            failed: stats.failed || 0,
          },
          next: nextJob ? {
            name: nextJob.name,
            at: formatDateTime(nextJob.next_run_at),
          } : null,
        }));
        break;
      }

      default:
        console.log(JSON.stringify({ error: `Unknown command: ${command}` }));
        process.exit(1);
    }
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.log(JSON.stringify({ error: error.message }));
  process.exit(1);
});
