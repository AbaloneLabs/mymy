/**
 * Platform detection + shortcut formatting helpers.
 *
 * `mod` is resolved to `⌘` on macOS and `Ctrl` on Windows/Linux so that the
 * same shortcut definition can be displayed consistently across platforms.
 */

/** True when the current user agent looks like macOS. */
export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const platform = navigator.platform ?? "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** Symbol used for the modifier key on the current platform. */
export const MOD_KEY = isMac() ? "⌘" : "Ctrl";

/**
 * Convert a single token from the internal representation to a display label.
 *
 * Internal tokens:
 *   - "mod"  → platform modifier (⌘ / Ctrl)
 *   - "ctrl" → "Ctrl"
 *   - "alt"  → "⌥" (mac) / "Alt"
 *   - "shift"→ "⇧" (mac) / "Shift"
 *   - other  → upper-cased single letter
 */
export function formatKey(key: string): string {
  switch (key.toLowerCase()) {
    case "mod":
      return MOD_KEY;
    case "ctrl":
    case "control":
      return "Ctrl";
    case "alt":
    case "option":
      return isMac() ? "⌥" : "Alt";
    case "shift":
      return isMac() ? "⇧" : "Shift";
    case "enter":
      return "↵";
    case "escape":
    case "esc":
      return "Esc";
    case "backspace":
      return "⌫";
    case "tab":
      return "Tab";
    case "space":
      return "Space";
    case "arrowup":
      return "↑";
    case "arrowdown":
      return "↓";
    case "arrowleft":
      return "←";
    case "arrowright":
      return "→";
    default:
      return key.length === 1 ? key.toUpperCase() : key;
  }
}

/**
 * Format a sequence of keys (as stored in the shortcut store) into the
 * hotkey string understood by `react-hotkeys-hook`.
 *
 *   ["mod", "k"]      → "mod+k"
 *   ["g", "h"]        → "g,h"  (sequence)
 */
export function toHotkeyString(keys: string[]): string {
  return keys.join(",");
}

/**
 * Whether a key array represents a sequence (e.g. ["g", "h"]) rather than a
 * chord (e.g. ["mod", "k"]). A sequence has no modifier tokens.
 */
export function isSequence(keys: string[]): boolean {
  const modifiers = new Set(["mod", "ctrl", "alt", "shift", "meta"]);
  return !keys.some((k) => modifiers.has(k.toLowerCase()));
}
