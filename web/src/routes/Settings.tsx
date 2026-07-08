import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/AppLayout";
import { SectionCard } from "@/components/settings/shared/SectionCard";
import { PinChangeForm } from "@/components/settings/pin/PinChangeForm";
import { AgentToolPermissionsSection } from "@/components/settings/agents/AgentToolPermissionsSection";
import { GitSystemSection } from "@/components/settings/git/GitSystemSection";
import { LlmProviderSection } from "@/components/settings/llm/LlmProviderSection";
import { ExtensionsSection } from "@/components/settings/extensions/ExtensionsSection";
import { EditorSettingsSection } from "@/components/settings/editor/EditorSettingsSection";
import { SkillsSection } from "@/components/settings/skills/SkillsSection";
import { SecuritySection } from "@/components/settings/security/SecuritySection";
import { AuditLogSection } from "@/components/settings/audit/AuditLogSection";
import { TaskStatusManager } from "@/components/settings/taskStatus/TaskStatusManager";
import { useSettingsStore } from "@/store/settings";
import { useUpdateLanguage } from "@/features/settings/api";
import { SUPPORTED_LANGUAGES, syncHtmlLang } from "@/i18n";
import type { Language } from "@/types/settings";
import { cn } from "@/lib/utils";

/**
 * Settings page — full-width workspace with a left tab sidebar.
 *
 * Layout (3 columns):
 *   [main sidebar] | [settings tabs] | [content panel]
 *
 * The active tab is stored in the URL search param `?tab=` so it is
 * bookmarkable, survives refresh, and supports back/forward navigation.
 *
 * Tabs:
 *   - General: language selector + app version
 *   - PIN: PinChangeForm
 *   - Chat / Calendar / Notes / Tasks: empty state (TODO(backend))
 *   - Agents: native agent permissions
 *   - Git: GitSystemSection
 *   - Audit: AuditLogSection (timeline of all changes)
 *   - About: version + ports
 */

type SettingsTab =
  | "general"
  | "pin"
  | "chat"
  | "calendar"
  | "notes"
  | "tasks"
  | "editor"
  | "agents"
  | "models"
  | "skills"
  | "extensions"
  | "security"
  | "git"
  | "audit"
  | "about";

const VALID_TABS: SettingsTab[] = [
  "general",
  "pin",
  "chat",
  "calendar",
  "notes",
  "tasks",
  "editor",
  "agents",
  "models",
  "skills",
  "extensions",
  "security",
  "git",
  "audit",
  "about",
];

/** Tab groups for visual separation with dividers. */
const TAB_GROUPS: { tabs: SettingsTab[] }[] = [
  { tabs: ["general", "pin"] },
  { tabs: ["chat", "calendar", "notes", "tasks", "editor"] },
  { tabs: ["agents", "models", "skills", "extensions", "security", "git"] },
  { tabs: ["audit"] },
  { tabs: ["about"] },
];

export default function Settings() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();

  // Read active tab from URL, default to "general".
  const rawTab = searchParams.get("tab");
  const activeTab: SettingsTab = (
    rawTab && VALID_TABS.includes(rawTab as SettingsTab)
      ? rawTab
      : "general"
  ) as SettingsTab;

  function selectTab(tab: SettingsTab) {
    setSearchParams({ tab }, { replace: true });
  }

  return (
    <AppLayout>
      <div className="flex h-full flex-col">
        {/* Header */}
        <header className="border-b border-[var(--border)] px-6 py-3">
          <h1 className="text-lg font-semibold text-[var(--text)]">
            {t("settings.title")}
          </h1>
        </header>

        {/* Body: tab sidebar + content panel */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left tab sidebar */}
          <nav className="w-[200px] shrink-0 space-y-0.5 overflow-y-auto border-r border-[var(--border)] px-2 py-3">
            {TAB_GROUPS.map((group, gi) => (
              <div key={gi} className="space-y-0.5">
                {gi > 0 && (
                  <div className="my-1.5 border-t border-[var(--border)]" />
                )}
                {group.tabs.map((tab) => (
                  <TabButton
                    key={tab}
                    label={t(`settings.tabs.${tab}`)}
                    active={activeTab === tab}
                    onClick={() => selectTab(tab)}
                  />
                ))}
              </div>
            ))}
          </nav>

          {/* Right content panel */}
          <div className="flex-1 overflow-y-auto px-6 py-6">
            <div className="space-y-6">
              {activeTab === "general" && <GeneralTab />}
              {activeTab === "pin" && <PinTab />}
              {activeTab === "chat" && (
                <FeaturePlaceholder feature={t("settings.tabs.chat")} />
              )}
              {activeTab === "calendar" && (
                <FeaturePlaceholder feature={t("settings.tabs.calendar")} />
              )}
              {activeTab === "notes" && (
                <FeaturePlaceholder feature={t("settings.tabs.notes")} />
              )}
              {activeTab === "tasks" && (
                <SectionCard
                  title={t("settings.tasks.title")}
                  description={t("settings.tasks.description")}
                >
                  <TaskStatusManager />
                </SectionCard>
              )}
              {activeTab === "editor" && (
                <SectionCard
                  title={t("settings.editor.title")}
                  description={t("settings.editor.description")}
                >
                  <EditorSettingsSection />
                </SectionCard>
              )}
              {activeTab === "agents" && (
                <SectionCard
                  title={t("settings.agentPermissions.title")}
                  description={t("settings.agentPermissions.description")}
                >
                  <AgentToolPermissionsSection />
                </SectionCard>
              )}
              {activeTab === "models" && (
                <SectionCard
                  title={t("settings.models.title")}
                  description={t("settings.models.description")}
                >
                  <LlmProviderSection />
                </SectionCard>
              )}
              {activeTab === "skills" && (
                <SectionCard
                  title={t("settings.skills.title")}
                  description={t("settings.skills.description")}
                >
                  <SkillsSection />
                </SectionCard>
              )}
              {activeTab === "extensions" && (
                <SectionCard
                  title={t("settings.extensions.title")}
                  description={t("settings.extensions.description")}
                >
                  <ExtensionsSection />
                </SectionCard>
              )}
              {activeTab === "git" && (
                <SectionCard
                  title={t("settings.git.title")}
                  description={t("settings.git.description")}
                >
                  <GitSystemSection />
                </SectionCard>
              )}
              {activeTab === "security" && (
                <SectionCard
                  title={t("settings.security.title")}
                  description={t("settings.security.description")}
                >
                  <SecuritySection />
                </SectionCard>
              )}
              {activeTab === "audit" && (
                <SectionCard
                  title={t("settings.audit.title")}
                  description={t("settings.audit.description")}
                >
                  <AuditLogSection />
                </SectionCard>
              )}
              {activeTab === "about" && <AboutTab />}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

// ===========================================================================
// Tab button
// ===========================================================================

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
        active
          ? "bg-[var(--surface-active)] font-medium text-[var(--text)]"
          : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
      )}
    >
      {label}
    </button>
  );
}

// ===========================================================================
// General tab
// ===========================================================================

function GeneralTab() {
  const { t, i18n } = useTranslation();
  const { settings, setLanguage, appVersion } = useSettingsStore();
  const updateLanguage = useUpdateLanguage();

  function handleLanguageChange(code: string) {
    const lang = code as Language;
    setLanguage(lang);
    void i18n.changeLanguage(lang);
    syncHtmlLang(lang);
    // Persist to backend (best-effort).
    updateLanguage.mutate(lang);
  }

  return (
    <SectionCard
      title={t("settings.general.title")}
      description={t("settings.general.description")}
    >
      <div className="space-y-4">
        {/* Language */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm text-[var(--text)]">
              {t("settings.general.language")}
            </div>
          </div>
          <select
            value={settings.language}
            onChange={(e) => handleLanguageChange(e.target.value)}
            className="rounded-md border border-[var(--border)] bg-[var(--surface-hover)] px-2.5 py-1.5 text-sm text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.label}
              </option>
            ))}
          </select>
        </div>

        {/* Version */}
        <div className="flex items-center justify-between gap-4 border-t border-[var(--border)] pt-4">
          <div className="text-sm text-[var(--text)]">
            {t("common.version")}
          </div>
          <span className="font-mono text-sm text-[var(--text-muted)]">
            v{appVersion}
          </span>
        </div>
      </div>
    </SectionCard>
  );
}

// ===========================================================================
// PIN tab
// ===========================================================================

function PinTab() {
  const { t } = useTranslation();
  return (
    <SectionCard
      title={t("settings.general.pinChange")}
      description={t("settings.general.pinHelp")}
    >
      <PinChangeForm />
    </SectionCard>
  );
}

// ===========================================================================
// Feature placeholder (Chat / Calendar / Notes / Tasks)
// ===========================================================================

// TODO(backend): per-feature settings (model, defaults, integrations, etc.)
function FeaturePlaceholder({ feature }: { feature: string }) {
  const { t } = useTranslation();
  return (
    <div className="py-20 text-center text-sm text-[var(--text-faint)]">
      {t("settings.featureComingSoon", { feature })}
    </div>
  );
}

// ===========================================================================
// About tab
// ===========================================================================

function AboutTab() {
  const { t } = useTranslation();
  const appVersion = useSettingsStore((s) => s.appVersion);

  return (
    <SectionCard title={t("settings.about.title")}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
        <InfoItem label={t("common.version")} value={`v${appVersion}`} />
        <InfoItem label={t("settings.about.web")} value=":33696" />
        <InfoItem label={t("settings.about.api")} value=":33697" />
        <InfoItem label={t("settings.about.db")} value=":33432" />
      </dl>
    </SectionCard>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-[var(--text-faint)]">{label}</dt>
      <dd className="mt-0.5 font-mono text-[var(--text-muted)]">{value}</dd>
    </div>
  );
}
