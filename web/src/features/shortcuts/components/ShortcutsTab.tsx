import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DEFAULT_BINDINGS, useShortcutStore } from "@/store/shortcuts";
import {
  SHORTCUT_CATEGORY_LABEL,
  SHORTCUT_CATEGORY_ORDER,
} from "./shortcutPageConfig";
import { ShortcutRow } from "./ShortcutRow";

export function ShortcutsTab() {
  const { t } = useTranslation();
  const resetAll = useShortcutStore((s) => s.resetAll);
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <>
      {confirmReset ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <span className="text-sm text-[var(--text-muted)]">
            {t("commandPalette.resetConfirm")}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                resetAll();
                setConfirmReset(false);
              }}
              className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[var(--accent-hover)]"
            >
              {t("common.delete")}
            </button>
            <button
              type="button"
              onClick={() => setConfirmReset(false)}
              className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)]"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmReset(true)}
          className="text-xs text-[var(--text-faint)] transition-colors hover:text-[var(--text-muted)]"
        >
          {t("commandPalette.resetAll")}
        </button>
      )}

      {SHORTCUT_CATEGORY_ORDER.map((category) => (
        <section
          key={category}
          className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]"
        >
          <h2 className="border-b border-[var(--border)] px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-[var(--text-faint)]">
            {t(SHORTCUT_CATEGORY_LABEL[category])}
          </h2>
          <ul className="divide-y divide-[var(--border)]">
            {DEFAULT_BINDINGS.filter((binding) => binding.category === category).map(
              (definition) => (
                <ShortcutRow
                  key={definition.actionId}
                  actionId={definition.actionId}
                />
              ),
            )}
          </ul>
        </section>
      ))}
    </>
  );
}
