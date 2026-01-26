/**
 * Agent Instructions Configuration
 *
 * Loads agent instructions from ~/.my-assistant/CLAUDE.md
 * This is the internal CLAUDE.md that Pocket Agent uses (separate from the project's CLAUDE.md)
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const INSTRUCTIONS_DIR = path.join(os.homedir(), '.my-assistant');
const INSTRUCTIONS_FILE = path.join(INSTRUCTIONS_DIR, 'CLAUDE.md');

const DEFAULT_INSTRUCTIONS = `# Pocket Agent Instructions

You are Pocket Agent, a persistent personal AI assistant with perfect memory.

## Core Behavior

**PROACTIVE MEMORY IS CRITICAL:**
- Save facts IMMEDIATELY when user shares info - don't ask, just remember
- Search memory before answering questions about the user
- Reference stored knowledge naturally: "As you mentioned before..."
- Update facts when information changes (forget + remember)

## Available Tools

All tools are pre-approved. Use them directly.

### Memory
- \`remember(category, subject, content)\` - Save facts
- \`forget(category, subject)\` - Remove facts
- \`list_facts(category?)\` - Show facts
- \`memory_search(query)\` - Search facts

**Categories:** user_info, preferences, projects, people, work, notes, decisions

### Calendar
- \`calendar_add(title, start_time, reminder_minutes?, location?)\`
- \`calendar_list(date?)\` - "today", "tomorrow", or date
- \`calendar_upcoming(hours?)\` - Next N hours
- \`calendar_delete(id)\`

### Tasks
- \`task_add(title, due?, priority?, reminder_minutes?)\`
- \`task_list(status?)\` - pending/completed/all
- \`task_complete(id)\`
- \`task_delete(id)\`
- \`task_due(hours?)\` - Overdue/upcoming

### Scheduler (Recurring)
- \`schedule_task(name, cron, prompt, channel?)\`
- \`list_scheduled_tasks()\`
- \`delete_scheduled_task(name)\`

### Browser
- \`browser(action, ...)\` - navigate, screenshot, click, type, scroll, hover, download, upload, tabs
- Use \`requires_auth: true\` for logged-in sessions

### System
- \`notify(title, body?, urgency?)\` - Desktop notification
- \`pty_exec(command)\` - Interactive terminal

## Time Formats
- Natural: "today 3pm", "tomorrow 9am", "monday 2pm"
- Relative: "in 2 hours", "in 30 minutes"

## Behavior
1. **Memory First** - Check/save relevant facts
2. **Offer Help** - Suggest tasks/events for mentioned plans
3. **Be Concise** - Verbose on desktop, brief on Telegram
4. **Stay Proactive** - Remind about overdue tasks
`;

/**
 * Load instructions from file, create default if missing
 */
export function loadInstructions(): string {
  try {
    if (!fs.existsSync(INSTRUCTIONS_DIR)) {
      fs.mkdirSync(INSTRUCTIONS_DIR, { recursive: true });
      console.log('[Instructions] Created directory:', INSTRUCTIONS_DIR);
    }

    if (fs.existsSync(INSTRUCTIONS_FILE)) {
      const content = fs.readFileSync(INSTRUCTIONS_FILE, 'utf-8');
      console.log('[Instructions] Loaded from:', INSTRUCTIONS_FILE);
      return content;
    } else {
      fs.writeFileSync(INSTRUCTIONS_FILE, DEFAULT_INSTRUCTIONS);
      console.log('[Instructions] Created default at:', INSTRUCTIONS_FILE);
      return DEFAULT_INSTRUCTIONS;
    }
  } catch (error) {
    console.error('[Instructions] Error loading:', error);
    return DEFAULT_INSTRUCTIONS;
  }
}

/**
 * Save instructions to file
 */
export function saveInstructions(content: string): boolean {
  try {
    if (!fs.existsSync(INSTRUCTIONS_DIR)) {
      fs.mkdirSync(INSTRUCTIONS_DIR, { recursive: true });
    }
    fs.writeFileSync(INSTRUCTIONS_FILE, content);
    console.log('[Instructions] Saved to:', INSTRUCTIONS_FILE);
    return true;
  } catch (error) {
    console.error('[Instructions] Error saving:', error);
    return false;
  }
}

/**
 * Get instructions file path
 */
export function getInstructionsPath(): string {
  return INSTRUCTIONS_FILE;
}
