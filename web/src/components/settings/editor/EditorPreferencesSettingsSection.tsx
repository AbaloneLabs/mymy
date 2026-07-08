import { useState } from "react";
import { Clock3, Loader2, Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EditorPreferences } from "@/types/editorSettings";

export function EditorPreferencesSection({
  loading,
  error,
  saving,
  preferences,
  onSave,
}: {
  loading: boolean;
  error: boolean;
  saving: boolean;
  preferences: EditorPreferences | null;
  onSave: (preferences: EditorPreferences) => void;
}) {
  const { t } = useTranslation();

  return (
    <section className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" strokeWidth={1.75} />
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[var(--text)]">
              {t("settings.editor.autosaveTitle")}
            </h3>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              {t("settings.editor.autosaveDescription")}
            </p>
          </div>
        </div>
        {saving && (
          <Loader2 className="h-4 w-4 animate-spin text-[var(--text-muted)]" strokeWidth={1.75} />
        )}
      </div>

      {loading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
          {t("common.loading")}
        </div>
      ) : error || !preferences ? (
        <div className="mt-4 rounded-md border border-[var(--status-error)]/40 bg-[var(--status-error)]/10 px-3 py-2 text-sm text-[var(--status-error)]">
          {t("settings.editor.preferencesError")}
        </div>
      ) : (
        <EditorPreferencesControls
          key={`${preferences.autosaveEnabled}:${preferences.autosaveDelayMs}`}
          preferences={preferences}
          saving={saving}
          onSave={onSave}
        />
      )}
    </section>
  );
}

function EditorPreferencesControls({
  preferences,
  saving,
  onSave,
}: {
  preferences: EditorPreferences;
  saving: boolean;
  onSave: (preferences: EditorPreferences) => void;
}) {
  const { t } = useTranslation();
  const [delaySecondsDraft, setDelaySecondsDraft] = useState(
    String(Math.round(preferences.autosaveDelayMs / 1000)),
  );

  function saveDelay() {
    const seconds = Number(delaySecondsDraft);
    if (!Number.isFinite(seconds)) return;
    const normalizedSeconds = Math.max(1, Math.min(60, Math.round(seconds)));
    setDelaySecondsDraft(String(normalizedSeconds));
    onSave({
      ...preferences,
      autosaveDelayMs: normalizedSeconds * 1000,
    });
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3">
      <label className="inline-flex items-center gap-2 text-sm text-[var(--text)]">
        <input
          type="checkbox"
          checked={preferences.autosaveEnabled}
          disabled={saving}
          onChange={(event) =>
            onSave({
              ...preferences,
              autosaveEnabled: event.currentTarget.checked,
            })
          }
        />
        {t("settings.editor.autosaveEnabled")}
      </label>
      <form
        className="inline-flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          saveDelay();
        }}
      >
        <label className="text-sm text-[var(--text-muted)]" htmlFor="editor-autosave-delay">
          {t("settings.editor.autosaveDelay")}
        </label>
        <input
          id="editor-autosave-delay"
          type="number"
          min={1}
          max={60}
          value={delaySecondsDraft}
          disabled={saving}
          onBlur={saveDelay}
          onChange={(event) => setDelaySecondsDraft(event.currentTarget.value)}
          className="h-8 w-20 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
        />
        <span className="text-sm text-[var(--text-muted)]">
          {t("settings.editor.seconds")}
        </span>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" strokeWidth={1.75} />
          {t("common.save")}
        </button>
      </form>
    </div>
  );
}
