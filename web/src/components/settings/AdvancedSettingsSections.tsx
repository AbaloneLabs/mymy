import { useTranslation } from "react-i18next";
import { SectionCard } from "./shared/SectionCard";
import { AgentToolPermissionsSection } from "./agents/AgentToolPermissionsSection";
import { GitSystemSection } from "./git/GitSystemSection";
import { LlmProviderSection } from "./llm/LlmProviderSection";
import { ExtensionsSection } from "./extensions/ExtensionsSection";
import { EditorSettingsSection } from "./editor/EditorSettingsSection";
import { SkillsSection } from "./skills/SkillsSection";
import { SecuritySection } from "./security/SecuritySection";
import { AuditLogSection } from "./audit/AuditLogSection";
import { TaskStatusManager } from "./taskStatus/TaskStatusManager";

/** Heavy settings adapters load only after their URL-addressable tab opens. */
export function AdvancedSettingsSections({ activeTab }: { activeTab: string }) {
  const { t } = useTranslation();
  const sections = {
    tasks: ["settings.tasks", <TaskStatusManager />],
    editor: ["settings.editor", <EditorSettingsSection />],
    agents: ["settings.agentPermissions", <AgentToolPermissionsSection />],
    models: ["settings.models", <LlmProviderSection />],
    skills: ["settings.skills", <SkillsSection />],
    extensions: ["settings.extensions", <ExtensionsSection />],
    git: ["settings.git", <GitSystemSection />],
    security: ["settings.security", <SecuritySection />],
    audit: ["settings.audit", <AuditLogSection />],
  } as const;
  const selected = sections[activeTab as keyof typeof sections];
  if (!selected) return null;
  return (
    <SectionCard
      title={t(`${selected[0]}.title`)}
      description={t(`${selected[0]}.description`)}
    >
      {selected[1]}
    </SectionCard>
  );
}
