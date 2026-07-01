/**
 * CommandPalette — Cmd+K overlay built on top of `cmdk`.
 *
 * Features:
 *   - Opens/closes via the commandPalette store (toggled by mod+K).
 *   - Fuzzy search filtering (cmdk built-in).
 *   - Keyboard navigation (↑/↓/Enter/Esc) handled by cmdk.
 *   - Commands grouped by category (Navigation / Create / Actions).
 *   - Each item shows its shortcut hint on the right.
 *   - Selecting an item runs its `perform` handler and closes the palette.
 */
import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Command } from "cmdk";
import { Search } from "lucide-react";
import {
  DEFAULT_COMMANDS,
  commandsByCategory,
  CATEGORY_LABEL_KEYS,
  type CommandContext,
  type CommandCategory,
} from "@/lib/commands";
import { useCommandPaletteStore } from "@/store/commandPalette";
import { useShortcutStore } from "@/store/shortcuts";
import { useCreateBus } from "@/store/createBus";
import { useLockApp } from "@/hooks/useLockApp";
import { ShortcutHint } from "@/components/ShortcutHint";
import { cn } from "@/lib/utils";

const CATEGORY_ORDER: CommandCategory[] = ["navigation", "create", "actions"];

export function CommandPalette() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const isOpen = useCommandPaletteStore((s) => s.isOpen);
  const closePalette = useCommandPaletteStore((s) => s.close);
  const getBinding = useShortcutStore((s) => s.getBinding);
  const triggerCreate = useCreateBus((s) => s.triggerCreate);
  const lock = useLockApp();

  // Close on Escape is handled by cmdk; also close on route change.
  useEffect(() => {
    closePalette();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Lock body scroll while the palette is open.
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const ctx: CommandContext = {
    navigate,
    currentPath: location.pathname,
    closePalette,
    lock,
    triggerCreate,
  };

  const grouped = commandsByCategory();

  function runCommand(perform: (ctx: CommandContext) => void) {
    perform(ctx);
    closePalette();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={t("commandPalette.title")}
    >
      {/* Overlay backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={closePalette}
      />

      {/* Palette */}
      <div className="relative mt-[12vh] w-full max-w-xl animate-[fadeIn_120ms_ease-out] px-4">
        <Command
          label={t("commandPalette.title")}
          className="overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] shadow-2xl"
          loop
        >
          {/* Search input */}
          <div className="flex items-center gap-2.5 border-b border-[var(--border)] px-3.5">
            <Search
              className="h-4 w-4 shrink-0 text-[var(--text-faint)]"
              strokeWidth={1.75}
            />
            <Command.Input
              placeholder={t("commandPalette.searchPlaceholder")}
              className="h-11 flex-1 bg-transparent text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none"
            />
            <kbd className="shrink-0 rounded border border-[var(--border)] bg-[var(--surface-hover)] px-1.5 py-0.5 font-mono text-[10px] font-medium text-[var(--text-faint)]">
              Esc
            </kbd>
          </div>

          {/* Command list */}
          <Command.List className="max-h-[min(60vh,400px)] overflow-y-auto p-2">
            <Command.Empty className="py-8 text-center text-sm text-[var(--text-faint)]">
              {t("commandPalette.noResults")}
            </Command.Empty>

            {CATEGORY_ORDER.map((category) => {
              const items = grouped[category];
              if (!items.length) return null;
              return (
                <Command.Group
                  key={category}
                  heading={t(CATEGORY_LABEL_KEYS[category])}
                  className={cn(
                    "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5",
                    "[&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium",
                    "[&_[cmdk-group-heading]]:text-[var(--text-faint)]"
                  )}
                >
                  {items.map((cmd) => {
                    const keys = getBinding(cmd.id);
                    return (
                      <Command.Item
                        key={cmd.id}
                        value={cmd.id}
                        keywords={cmd.keywords}
                        onSelect={() => runCommand(cmd.perform)}
                        className={cn(
                          "flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-sm",
                          "text-[var(--text-muted)]",
                          "data-[selected=true]:bg-[var(--surface-hover)] data-[selected=true]:text-[var(--text)]",
                          "transition-colors duration-100"
                        )}
                      >
                        <cmd.icon
                          className="h-4 w-4 shrink-0"
                          strokeWidth={1.5}
                        />
                        <span className="flex-1">{t(cmd.labelKey)}</span>
                        {keys.length > 0 && <ShortcutHint keys={keys} />}
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              );
            })}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}

// Re-export for convenience (e.g. importing the registry elsewhere).
export { DEFAULT_COMMANDS };
