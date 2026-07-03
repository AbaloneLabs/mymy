import type { LucideIcon } from "lucide-react";
import {
  Home,
  MessageSquare,
  Calendar,
  NotebookPen,
  CheckSquare,
  BookOpen,
  Bot,
  Wallet,
  HardDrive,
  Target,
  Settings,
  Keyboard,
  Lock,
  Plus,
} from "lucide-react";

/**
 * Command registry — the single source of truth for every action that can be
 * triggered from the command palette (Cmd+K) or a keyboard shortcut.
 *
 * Commands are data: they carry an id, label key, icon, category and a
 * `perform` callback. The palette and the shortcuts page both render from
 * this list, keeping the two in sync.
 */

export type CommandCategory = "navigation" | "create" | "actions";

/** Context passed to a command's `perform` handler. */
export interface CommandContext {
  /** React Router navigate function. */
  navigate: (path: string) => void;
  /** Current pathname (e.g. "/notes"). */
  currentPath: string;
  /** Close the command palette overlay. */
  closePalette: () => void;
  /** Lock the app (return to PIN screen). */
  lock: () => void;
  /** Trigger a context create action (e.g. open the new-note form). */
  triggerCreate: (actionId: string) => void;
}

export interface CommandAction {
  /** Stable unique id (also used as the shortcut actionId). */
  id: string;
  /** i18n key for the display label. */
  labelKey: string;
  /** Optional i18n key for a short description. */
  descriptionKey?: string;
  /** lucide-react icon component. */
  icon: LucideIcon;
  /** Group used by the palette and the shortcuts page. */
  category: CommandCategory;
  /** Search keywords (aliases) for cmdk filtering. */
  keywords?: string[];
  /** Execute the command. */
  perform: (ctx: CommandContext) => void;
}

/**
 * All commands available in the palette and via shortcuts.
 *
 * Navigation commands mirror the sidebar NAV_ITEMS paths.
 * Create commands dispatch a context action that each page listens for.
 */
export const DEFAULT_COMMANDS: CommandAction[] = [
  // --- Navigation ---
  {
    id: "navigate.home",
    labelKey: "commandPalette.commands.goHome",
    icon: Home,
    category: "navigation",
    keywords: ["dashboard", "main"],
    perform: (ctx) => ctx.navigate("/"),
  },
  {
    id: "navigate.chat",
    labelKey: "commandPalette.commands.goChat",
    icon: MessageSquare,
    category: "navigation",
    perform: (ctx) => ctx.navigate("/chat"),
  },
  {
    id: "navigate.calendar",
    labelKey: "commandPalette.commands.goCalendar",
    icon: Calendar,
    category: "navigation",
    perform: (ctx) => ctx.navigate("/calendar"),
  },
  {
    id: "navigate.notes",
    labelKey: "commandPalette.commands.goNotes",
    icon: NotebookPen,
    category: "navigation",
    perform: (ctx) => ctx.navigate("/notes"),
  },
  {
    id: "navigate.tasks",
    labelKey: "commandPalette.commands.goTasks",
    icon: CheckSquare,
    category: "navigation",
    perform: (ctx) => ctx.navigate("/tasks"),
  },
  {
    id: "navigate.knowledge",
    labelKey: "commandPalette.commands.goKnowledge",
    icon: BookOpen,
    category: "navigation",
    perform: (ctx) => ctx.navigate("/knowledge"),
  },
  {
    id: "navigate.agents",
    labelKey: "commandPalette.commands.goAgents",
    icon: Bot,
    category: "navigation",
    perform: (ctx) => ctx.navigate("/agents"),
  },
  {
    id: "navigate.finance",
    labelKey: "commandPalette.commands.goFinance",
    icon: Wallet,
    category: "navigation",
    perform: (ctx) => ctx.navigate("/finance"),
  },
  {
    id: "navigate.drive",
    labelKey: "commandPalette.commands.goDrive",
    icon: HardDrive,
    category: "navigation",
    perform: (ctx) => ctx.navigate("/drive"),
  },
  {
    id: "navigate.goals",
    labelKey: "commandPalette.commands.goGoals",
    icon: Target,
    category: "navigation",
    perform: (ctx) => ctx.navigate("/goals"),
  },
  {
    id: "navigate.settings",
    labelKey: "commandPalette.commands.goSettings",
    icon: Settings,
    category: "navigation",
    perform: (ctx) => ctx.navigate("/settings"),
  },
  {
    id: "navigate.shortcuts",
    labelKey: "commandPalette.commands.goShortcuts",
    icon: Keyboard,
    category: "navigation",
    keywords: ["keyboard", "hotkeys"],
    perform: (ctx) => ctx.navigate("/shortcuts"),
  },

  // --- Create ---
  {
    id: "create.task",
    labelKey: "commandPalette.commands.newTask",
    icon: Plus,
    category: "create",
    perform: (ctx) => ctx.triggerCreate("create.task"),
  },
  {
    id: "create.note",
    labelKey: "commandPalette.commands.newNote",
    icon: Plus,
    category: "create",
    perform: (ctx) => ctx.triggerCreate("create.note"),
  },
  {
    id: "create.event",
    labelKey: "commandPalette.commands.newEvent",
    icon: Plus,
    category: "create",
    perform: (ctx) => ctx.triggerCreate("create.event"),
  },
  {
    id: "create.chat",
    labelKey: "commandPalette.commands.newChat",
    icon: Plus,
    category: "create",
    perform: (ctx) => ctx.triggerCreate("create.chat"),
  },

  // --- Actions ---
  {
    id: "palette.toggle",
    labelKey: "commandPalette.commands.openPalette",
    icon: Keyboard,
    category: "actions",
    keywords: ["command", "search"],
    perform: (ctx) => ctx.closePalette(),
  },
  {
    id: "action.lock",
    labelKey: "commandPalette.commands.lockScreen",
    icon: Lock,
    category: "actions",
    perform: (ctx) => ctx.lock(),
  },
];

/** Commands grouped by category, for palette/shortcuts rendering. */
export function commandsByCategory(): Record<CommandCategory, CommandAction[]> {
  const groups: Record<CommandCategory, CommandAction[]> = {
    navigation: [],
    create: [],
    actions: [],
  };
  for (const cmd of DEFAULT_COMMANDS) {
    groups[cmd.category].push(cmd);
  }
  return groups;
}

/** i18n keys for category headings. */
export const CATEGORY_LABEL_KEYS: Record<CommandCategory, string> = {
  navigation: "commandPalette.categories.navigation",
  create: "commandPalette.categories.create",
  actions: "commandPalette.categories.actions",
};
