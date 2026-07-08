import type { ShortcutCategory } from "@/store/shortcuts";

export type ShortcutsPageTab = "commands" | "shortcuts";

export const VALID_SHORTCUT_TABS: ShortcutsPageTab[] = [
  "commands",
  "shortcuts",
];

export const SHORTCUT_CATEGORY_ORDER: ShortcutCategory[] = [
  "navigation",
  "global",
  "actions",
];

export const SHORTCUT_CATEGORY_LABEL: Record<ShortcutCategory, string> = {
  navigation: "commandPalette.categories.navigation",
  global: "commandPalette.categories.global",
  actions: "commandPalette.categories.actions",
};
