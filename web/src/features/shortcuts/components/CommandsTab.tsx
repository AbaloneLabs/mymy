import { useTranslation } from "react-i18next";
import {
  CATEGORY_LABEL_KEYS,
  commandsByCategory,
  type CommandCategory,
} from "@/lib/commands";

export function CommandsTab() {
  const { t } = useTranslation();
  const grouped = commandsByCategory();
  const order: CommandCategory[] = ["navigation", "create", "actions"];

  return (
    <>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="text-sm text-[var(--text)]">
          {t("commandPalette.paletteHint")}
        </div>
      </div>

      {order.map((category) => {
        const items = grouped[category];
        if (!items.length) return null;
        return (
          <section
            key={category}
            className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]"
          >
            <h2 className="border-b border-[var(--border)] px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-[var(--text-faint)]">
              {t(CATEGORY_LABEL_KEYS[category])}
            </h2>
            <ul className="divide-y divide-[var(--border)]">
              {items.map((cmd) => (
                <li key={cmd.id} className="flex items-center gap-3 px-4 py-2.5">
                  <cmd.icon
                    className="h-4 w-4 shrink-0 text-[var(--text-faint)]"
                    strokeWidth={1.5}
                  />
                  <span className="flex-1 text-sm text-[var(--text)]">
                    {t(cmd.labelKey)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
