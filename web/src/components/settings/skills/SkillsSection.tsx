import { useState } from "react";
import { Loader2, Plus, Save, Settings2, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  type NativeSkill,
  type SkillBundle,
  type SkillsConfig,
  useDeleteSkillBundle,
  useNativeSkills,
  useSaveSkillBundle,
  useSkillBundles,
  useSkillsConfig,
  useUpdateSkillsConfig,
} from "@/features/skills/api";
import { TextField } from "../shared/TextField";
import { Toggle } from "../shared/Toggle";

export function SkillsSection() {
  const { t } = useTranslation();
  const skillsQuery = useNativeSkills();
  const bundlesQuery = useSkillBundles();
  const configQuery = useSkillsConfig();
  const skills = skillsQuery.data?.skills ?? [];
  const bundles = bundlesQuery.data?.bundles ?? [];
  const config = configQuery.data?.config;
  const loading =
    skillsQuery.isLoading || bundlesQuery.isLoading || configQuery.isLoading;
  const failed =
    skillsQuery.isError || bundlesQuery.isError || configQuery.isError;

  return (
    <div className="space-y-4">
      {loading && (
        <div className="flex items-center justify-center py-8 text-[var(--text-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
        </div>
      )}

      {!loading && failed && (
        <div className="rounded-lg border border-[var(--status-error)]/30 bg-[var(--status-error)]/5 p-3 text-xs text-[var(--status-error)]">
          {t("settings.skills.loadError")}
        </div>
      )}

      {!loading && !failed && (
        <>
          {config && (
            <SkillsConfigPanel
              key={`${config.templateVars}-${config.inlineShell}-${config.inlineShellTimeoutSecs}`}
              config={config}
            />
          )}
          <BundlePanel skills={skills} bundles={bundles} />
        </>
      )}
    </div>
  );
}

function SkillsConfigPanel({ config }: { config: SkillsConfig }) {
  const { t } = useTranslation();
  const updateMutation = useUpdateSkillsConfig();
  const [templateVars, setTemplateVars] = useState(config.templateVars);
  const [inlineShell, setInlineShell] = useState(config.inlineShell);
  const [timeoutSecs, setTimeoutSecs] = useState(
    String(config.inlineShellTimeoutSecs),
  );

  function save() {
    updateMutation.mutate({
      templateVars,
      inlineShell,
      inlineShellTimeoutSecs: Number(timeoutSecs) || 10,
    });
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="mb-3 flex items-center gap-2">
        <Settings2 className="h-4 w-4 text-[var(--text-muted)]" strokeWidth={1.5} />
        <h3 className="text-sm font-medium text-[var(--text)]">
          {t("settings.skills.configTitle")}
        </h3>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="flex items-center justify-between gap-3 rounded-md border border-[var(--border)] px-3 py-2 text-xs text-[var(--text-muted)]">
          {t("settings.skills.templateVars")}
          <Toggle
            checked={templateVars}
            onChange={setTemplateVars}
            disabled={updateMutation.isPending}
            ariaLabel={t("settings.skills.templateVars")}
          />
        </label>
        <label className="flex items-center justify-between gap-3 rounded-md border border-[var(--border)] px-3 py-2 text-xs text-[var(--text-muted)]">
          {t("settings.skills.inlineShell")}
          <Toggle
            checked={inlineShell}
            onChange={setInlineShell}
            disabled={updateMutation.isPending}
            ariaLabel={t("settings.skills.inlineShell")}
          />
        </label>
        <label className="space-y-1 text-xs text-[var(--text-muted)]">
          {t("settings.skills.timeout")}
          <TextField
            type="number"
            value={timeoutSecs}
            onChange={setTimeoutSecs}
            disabled={updateMutation.isPending}
          />
        </label>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        {updateMutation.isError && (
          <span className="mr-auto text-xs text-[var(--danger)]">
            {t("settings.skills.configSaveFailed")}
          </span>
        )}
        <button
          type="button"
          onClick={save}
          disabled={updateMutation.isPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-2.5 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {updateMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
          ) : (
            <Save className="h-3.5 w-3.5" strokeWidth={1.5} />
          )}
          {t("settings.skills.saveConfig")}
        </button>
      </div>
    </div>
  );
}

function BundlePanel({
  skills,
  bundles,
}: {
  skills: NativeSkill[];
  bundles: SkillBundle[];
}) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-[var(--text)]">
          {t("settings.skills.bundlesTitle")}
        </h3>
        <button
          type="button"
          onClick={() => setAdding(true)}
          disabled={adding || skills.length === 0}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          {t("settings.skills.addBundle")}
        </button>
      </div>

      {skills.length === 0 && (
        <div className="rounded-lg border border-dashed border-[var(--border)] p-4 text-center text-xs text-[var(--text-muted)]">
          {t("settings.skills.emptySkills")}
        </div>
      )}

      {bundles.length === 0 && skills.length > 0 && !adding && (
        <div className="rounded-lg border border-dashed border-[var(--border)] p-4 text-center text-xs text-[var(--text-muted)]">
          {t("settings.skills.emptyBundles")}
        </div>
      )}

      <div className="space-y-2">
        {bundles.map((bundle) => (
          <BundleCard key={bundle.name} bundle={bundle} />
        ))}
      </div>

      {adding && (
        <BundleForm skills={skills} onClose={() => setAdding(false)} />
      )}
    </div>
  );
}

function BundleCard({ bundle }: { bundle: SkillBundle }) {
  const { t } = useTranslation();
  const deleteMutation = useDeleteSkillBundle();

  function remove() {
    if (!window.confirm(t("settings.skills.deleteConfirm", { name: bundle.name }))) {
      return;
    }
    deleteMutation.mutate(bundle.name);
  }

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-medium text-[var(--text)]">
            {bundle.name}
          </h4>
          {bundle.description && (
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {bundle.description}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={remove}
          disabled={deleteMutation.isPending}
          className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={t("settings.skills.delete")}
        >
          <Trash2 className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {bundle.skills.map((skill) => (
          <span
            key={skill}
            className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)]"
          >
            {skill}
          </span>
        ))}
      </div>
      {bundle.instruction && (
        <p className="mt-3 whitespace-pre-wrap text-xs text-[var(--text-muted)]">
          {bundle.instruction}
        </p>
      )}
    </div>
  );
}

function BundleForm({
  skills,
  onClose,
}: {
  skills: NativeSkill[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const saveMutation = useSaveSkillBundle();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instruction, setInstruction] = useState("");
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);

  function toggleSkill(skillName: string) {
    setSelectedSkills((current) =>
      current.includes(skillName)
        ? current.filter((item) => item !== skillName)
        : [...current, skillName],
    );
  }

  function submit() {
    saveMutation.mutate(
      {
        name,
        description,
        skills: selectedSkills,
        instruction: instruction.trim() ? instruction : null,
      },
      { onSuccess: onClose },
    );
  }

  const canSave = name.trim() && selectedSkills.length > 0;

  return (
    <div className="mt-3 rounded-md border border-[var(--border)] bg-[var(--bg)] p-3">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-xs text-[var(--text-muted)]">
          {t("settings.skills.name")}
          <TextField value={name} onChange={setName} placeholder="backend-dev" />
        </label>
        <label className="space-y-1 text-xs text-[var(--text-muted)]">
          {t("settings.skills.descriptionLabel")}
          <TextField value={description} onChange={setDescription} />
        </label>
      </div>
      <label className="mt-3 block space-y-1 text-xs text-[var(--text-muted)]">
        {t("settings.skills.instruction")}
        <textarea
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          className="min-h-24 w-full resize-y rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
        />
      </label>
      <div className="mt-3 space-y-2">
        <div className="flex items-center justify-between gap-3 text-xs text-[var(--text-muted)]">
          <span>{t("settings.skills.selectSkills")}</span>
          <span>{t("settings.skills.selectedCount", { n: selectedSkills.length })}</span>
        </div>
        <div className="max-h-52 overflow-auto rounded-md border border-[var(--border)]">
          {skills.map((skill) => (
            <label
              key={skill.name}
              className="flex cursor-pointer items-start gap-2 border-b border-[var(--border)] px-3 py-2 last:border-b-0 hover:bg-[var(--surface-hover)]"
            >
              <input
                type="checkbox"
                checked={selectedSkills.includes(skill.name)}
                onChange={() => toggleSkill(skill.name)}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block truncate font-mono text-xs text-[var(--text)]">
                  {skill.name}
                </span>
                <span className="block truncate text-xs text-[var(--text-muted)]">
                  {skill.description}
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        {saveMutation.isError && (
          <span className="mr-auto text-xs text-[var(--danger)]">
            {t("settings.skills.saveFailed")}
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.5} />
          {t("settings.skills.cancel")}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={saveMutation.isPending || !canSave}
          className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-2.5 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saveMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
          ) : (
            <Save className="h-3.5 w-3.5" strokeWidth={1.5} />
          )}
          {t("settings.skills.save")}
        </button>
      </div>
    </div>
  );
}
