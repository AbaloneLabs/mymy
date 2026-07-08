import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/AppLayout";
import { CommandsTab } from "@/features/shortcuts/components/CommandsTab";
import { ShortcutTabButton } from "@/features/shortcuts/components/ShortcutTabButton";
import { ShortcutsTab } from "@/features/shortcuts/components/ShortcutsTab";
import {
  type ShortcutsPageTab,
  VALID_SHORTCUT_TABS,
} from "@/features/shortcuts/components/shortcutPageConfig";

export default function ShortcutsPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  const rawTab = searchParams.get("tab");
  const activeTab: ShortcutsPageTab =
    rawTab && VALID_SHORTCUT_TABS.includes(rawTab as ShortcutsPageTab)
      ? (rawTab as ShortcutsPageTab)
      : "shortcuts";

  function selectTab(tab: ShortcutsPageTab) {
    setSearchParams({ tab }, { replace: true });
  }

  return (
    <AppLayout>
      <div className="flex h-full flex-col">
        <header className="border-b border-[var(--border)] px-6 py-3">
          <h1 className="text-lg font-semibold text-[var(--text)]">
            {t("commandPalette.shortcutsTitle")}
          </h1>
        </header>

        <div className="flex flex-1 overflow-hidden">
          <nav className="w-[200px] shrink-0 space-y-0.5 overflow-y-auto border-r border-[var(--border)] px-2 py-3">
            <ShortcutTabButton
              label={t("commandPalette.tabs.commands")}
              active={activeTab === "commands"}
              onClick={() => selectTab("commands")}
            />
            <ShortcutTabButton
              label={t("commandPalette.tabs.shortcuts")}
              active={activeTab === "shortcuts"}
              onClick={() => selectTab("shortcuts")}
            />
          </nav>

          <div className="flex-1 overflow-y-auto px-6 py-6">
            <div className="mx-auto max-w-2xl space-y-6">
              {activeTab === "commands" && <CommandsTab />}
              {activeTab === "shortcuts" && <ShortcutsTab />}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
