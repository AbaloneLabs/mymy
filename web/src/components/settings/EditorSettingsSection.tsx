import { useRef, useState } from "react";
import { Clock3, FileDown, Keyboard, Loader2, RotateCcw, Save, Trash2, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  builtInFontFamilies,
  useDeleteEditorFont,
  useEditorFonts,
  useEditorKeymap,
  useEditorPreferences,
  useUpdateEditorKeymap,
  useUpdateEditorPreferences,
  useUploadEditorFonts,
} from "@/features/documentEditor/fonts";
import {
  editorCommandsForKind,
  type EditorCommandDefinition,
  type EditorCommandId,
  type EditorShortcut,
} from "@/features/documentEditor/commands";
import { formatBytes, formatDate } from "@/features/drive/utils";
import type { DocumentEditorKind } from "@/types/documentEditor";
import type {
  EditorFont,
  EditorKeymapEntry,
  EditorPreferences,
} from "@/types/editorSettings";

const keymapEditorKinds: Array<{ kind: DocumentEditorKind; label: string }> = [
  { kind: "text", label: "Text / JSON / YAML / TOML" },
  { kind: "markdown", label: "Markdown" },
  { kind: "docx", label: "DOCX" },
  { kind: "xlsx", label: "XLSX / CSV / TSV" },
  { kind: "pptx", label: "PPTX" },
];

export function EditorSettingsSection() {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fonts = useEditorFonts();
  const uploadFonts = useUploadEditorFonts();
  const deleteFont = useDeleteEditorFont();
  const keymap = useEditorKeymap();
  const updateKeymap = useUpdateEditorKeymap();
  const preferences = useEditorPreferences();
  const updatePreferences = useUpdateEditorPreferences();
  const [selectedKind, setSelectedKind] = useState<DocumentEditorKind>("text");
  const customFonts = fonts.data?.fonts ?? [];
  const keymapEntries = keymap.data?.shortcuts ?? [];

  function handleUpload(files: FileList | null) {
    const selected = Array.from(files ?? []);
    if (selected.length === 0) return;
    uploadFonts.mutate(selected, {
      onSettled: () => {
        if (fileInputRef.current) fileInputRef.current.value = "";
      },
    });
  }

  return (
    <div className="space-y-6">
      <EditorPreferencesSection
        loading={preferences.isLoading}
        error={preferences.isError}
        saving={updatePreferences.isPending}
        preferences={preferences.data?.preferences ?? null}
        onSave={(next) => updatePreferences.mutate(next)}
      />

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text)]">
            {t("settings.editor.fontsTitle")}
          </h3>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {t("settings.editor.fontsDescription")}
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {builtInFontFamilies.map((font) => (
            <div
              key={font}
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            >
              <div className="text-sm text-[var(--text)]" style={{ fontFamily: font }}>
                {font}
              </div>
              <div className="mt-1 text-[11px] text-[var(--text-faint)]">
                {t("settings.editor.builtInFreeFont")}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3 border-t border-[var(--border)] pt-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-[var(--text)]">
              {t("settings.editor.customFontsTitle")}
            </h3>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              {t("settings.editor.customFontsDescription")}
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
            className="hidden"
            onChange={(event) => handleUpload(event.currentTarget.files)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadFonts.isPending}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-[var(--accent)] px-3 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {uploadFonts.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
            ) : (
              <Upload className="h-4 w-4" strokeWidth={1.75} />
            )}
            {t("settings.editor.uploadFonts")}
          </button>
        </div>

        {uploadFonts.isError && (
          <div className="rounded-md border border-[var(--status-error)]/40 bg-[var(--status-error)]/10 px-3 py-2 text-sm text-[var(--status-error)]">
            {t("settings.editor.uploadError")}
          </div>
        )}

        {fonts.isLoading && (
          <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
            {t("common.loading")}
          </div>
        )}

        {!fonts.isLoading && customFonts.length === 0 && (
          <div className="rounded-md border border-dashed border-[var(--border)] px-4 py-6 text-center text-sm text-[var(--text-faint)]">
            {t("settings.editor.noCustomFonts")}
          </div>
        )}

        {customFonts.length > 0 && (
          <div className="space-y-2">
            {customFonts.map((font) => {
              const metadata = editorFontMetadataParts(font, t);
              return (
                <div
                  key={font.id}
                  className="flex items-start gap-3 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div
                      className="truncate text-sm font-medium text-[var(--text)]"
                      style={{ fontFamily: font.displayName }}
                    >
                      {font.displayName}
                    </div>
                    <div className="truncate text-xs text-[var(--text-faint)]">
                      {font.fileName} · {formatBytes(font.size)}
                      {font.uploadedAt ? ` · ${formatDate(font.uploadedAt)}` : ""}
                    </div>
                    {metadata.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {metadata.map((item) => (
                          <span
                            key={item}
                            className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-1.5 py-0.5 text-[11px] text-[var(--text-muted)]"
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => deleteFont.mutate(font.id)}
                    disabled={deleteFont.isPending}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--status-error)]/10 hover:text-[var(--status-error)] disabled:opacity-50"
                    title={t("common.delete")}
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex items-start gap-3">
          <FileDown className="mt-0.5 h-4 w-4 text-[var(--text-muted)]" strokeWidth={1.75} />
          <div>
            <h3 className="text-sm font-semibold text-[var(--text)]">
              {t("settings.editor.downloadPackageTitle")}
            </h3>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              {t("settings.editor.downloadPackageDescription")}
            </p>
          </div>
        </div>
      </section>

      <EditorKeymapSection
        selectedKind={selectedKind}
        onSelectedKindChange={setSelectedKind}
        keymapEntries={keymapEntries}
        loading={keymap.isLoading}
        saving={updateKeymap.isPending}
        onSave={(shortcuts) => updateKeymap.mutate(shortcuts)}
      />
    </div>
  );
}

function EditorPreferencesSection({
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

function EditorKeymapSection({
  selectedKind,
  onSelectedKindChange,
  keymapEntries,
  loading,
  saving,
  onSave,
}: {
  selectedKind: DocumentEditorKind;
  onSelectedKindChange: (kind: DocumentEditorKind) => void;
  keymapEntries: EditorKeymapEntry[];
  loading: boolean;
  saving: boolean;
  onSave: (shortcuts: EditorKeymapEntry[]) => void;
}) {
  const { t } = useTranslation();
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const defaultCommands = uniqueCommands(editorCommandsForKind(selectedKind));
  const effectiveCommands = uniqueCommands(editorCommandsForKind(selectedKind, keymapEntries));

  function setShortcut(commandId: EditorCommandId, shortcut: EditorShortcut) {
    const conflict = effectiveCommands.find(
      (command) =>
        command.id !== commandId && shortcutsEqual(command.shortcuts[0], shortcut),
    );
    if (conflict) {
      setShortcutError(
        t("settings.editor.keymapConflict", {
          command: t(conflict.labelKey, { defaultValue: conflict.fallbackLabel }),
          defaultValue: "Shortcut already used by {command}.",
        }),
      );
      return;
    }
    setShortcutError(null);
    const next = [
      ...keymapEntries.filter(
        (entry) => !(entry.editorKind === selectedKind && entry.commandId === commandId),
      ),
      {
        editorKind: selectedKind,
        commandId,
        shortcut: {
          key: shortcut.key,
          display: shortcut.display,
          primary: Boolean(shortcut.primary),
          shift: Boolean(shortcut.shift),
          alt: Boolean(shortcut.alt),
        },
      },
    ];
    onSave(next);
  }

  function resetShortcut(commandId: EditorCommandId) {
    setShortcutError(null);
    onSave(
      keymapEntries.filter(
        (entry) => !(entry.editorKind === selectedKind && entry.commandId === commandId),
      ),
    );
  }

  function resetKind() {
    setShortcutError(null);
    onSave(keymapEntries.filter((entry) => entry.editorKind !== selectedKind));
  }

  return (
    <section className="space-y-3 border-t border-[var(--border)] pt-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-[var(--text)]">
            {t("settings.editor.keymapTitle", { defaultValue: "Keyboard shortcuts" })}
          </h3>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {t("settings.editor.keymapDescription", {
              defaultValue: "Customize editor shortcuts by file type.",
            })}
          </p>
        </div>
        <select
          value={selectedKind}
          onChange={(event) => {
            setShortcutError(null);
            onSelectedKindChange(event.target.value as DocumentEditorKind);
          }}
          className="h-9 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]"
        >
          {keymapEditorKinds.map((item) => (
            <option key={item.kind} value={item.kind}>
              {item.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={resetKind}
          disabled={saving}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--border)] px-3 text-sm text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RotateCcw className="h-4 w-4" strokeWidth={1.75} />
          {t("common.reset", { defaultValue: "Reset" })}
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
          {t("common.loading")}
        </div>
      ) : (
        <>
          {shortcutError && (
            <div className="rounded-md border border-[var(--status-warning)]/40 bg-[var(--status-warning)]/10 px-3 py-2 text-sm text-[var(--status-warning)]">
              {shortcutError}
            </div>
          )}
          <div className="divide-y divide-[var(--border)] rounded-md border border-[var(--border)] bg-[var(--surface)]">
            {defaultCommands.map((command) => {
              const effective =
                effectiveCommands.find((item) => item.id === command.id) ?? command;
              const overridden = keymapEntries.some(
                (entry) => entry.editorKind === selectedKind && entry.commandId === command.id,
              );
              return (
                <div
                  key={command.id}
                  className="grid gap-2 px-3 py-2 md:grid-cols-[minmax(160px,1fr)_minmax(140px,220px)_auto]"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-[var(--text)]">
                      {t(command.labelKey, { defaultValue: command.fallbackLabel })}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-[var(--text-faint)]">
                      {command.id}
                    </div>
                  </div>
                  <ShortcutCaptureButton
                    command={command}
                    effective={effective}
                    disabled={saving}
                    onCapture={(shortcut) => setShortcut(command.id, shortcut)}
                  />
                  <button
                    type="button"
                    onClick={() => resetShortcut(command.id)}
                    disabled={!overridden || saving}
                    className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
                    {t("common.reset", { defaultValue: "Reset" })}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

function ShortcutCaptureButton({
  command,
  effective,
  disabled,
  onCapture,
}: {
  command: EditorCommandDefinition;
  effective: EditorCommandDefinition;
  disabled: boolean;
  onCapture: (shortcut: EditorShortcut) => void;
}) {
  const { t } = useTranslation();
  const shortcut = effective.shortcuts[0] ?? command.shortcuts[0];
  return (
    <button
      type="button"
      disabled={disabled}
      onKeyDown={(event) => {
        const next = shortcutFromEvent(event);
        if (!next) return;
        event.preventDefault();
        onCapture(next);
      }}
      className="inline-flex h-8 min-w-0 items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] focus:border-[var(--accent)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      title={t("settings.editor.captureShortcut", {
        defaultValue: "Focus and press a new shortcut",
      })}
    >
      <Keyboard className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
      <kbd className="truncate font-mono text-[11px] text-[var(--text)]">
        {shortcut?.display ?? "-"}
      </kbd>
    </button>
  );
}

function uniqueCommands(commands: EditorCommandDefinition[]) {
  const seen = new Set<EditorCommandId>();
  return commands.filter((command) => {
    if (seen.has(command.id)) return false;
    seen.add(command.id);
    return true;
  });
}

function editorFontMetadataParts(
  font: EditorFont,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  return [
    font.familyName && font.familyName !== font.displayName
      ? `${t("settings.editor.fontFamilyLabel", { defaultValue: "Family" })}: ${font.familyName}`
      : null,
    font.subfamilyName
      ? `${t("settings.editor.fontStyleLabel", { defaultValue: "Style" })}: ${font.subfamilyName}`
      : null,
    font.weightClass
      ? `${t("settings.editor.fontWeightLabel", { defaultValue: "Weight" })}: ${font.weightClass}`
      : null,
    font.widthClass
      ? `${t("settings.editor.fontWidthLabel", { defaultValue: "Width" })}: ${font.widthClass}`
      : null,
    font.embedding
      ? `${t("settings.editor.fontEmbeddingLabel", { defaultValue: "Embedding" })}: ${font.embedding}`
      : null,
    font.supportedScripts.length > 0
      ? `${t("settings.editor.fontScriptsLabel", { defaultValue: "Scripts" })}: ${font.supportedScripts.slice(0, 4).join(", ")}`
      : null,
    font.license
      ? `${t("settings.editor.fontLicenseLabel", { defaultValue: "License" })}: ${font.license}`
      : null,
  ].filter((item): item is string => Boolean(item));
}

function shortcutsEqual(left: EditorShortcut | undefined, right: EditorShortcut) {
  if (!left) return false;
  return (
    left.key.toLowerCase() === right.key.toLowerCase() &&
    Boolean(left.primary) === Boolean(right.primary) &&
    Boolean(left.shift) === Boolean(right.shift) &&
    Boolean(left.alt) === Boolean(right.alt)
  );
}

function shortcutFromEvent(event: React.KeyboardEvent<HTMLButtonElement>): EditorShortcut | null {
  if (event.nativeEvent.isComposing) return null;
  const key = normalizeShortcutKey(event.key);
  if (!key || key === "Control" || key === "Meta" || key === "Shift" || key === "Alt") {
    return null;
  }
  const shortcut: EditorShortcut = {
    key,
    display: displayShortcut({
      key,
      primary: event.ctrlKey || event.metaKey,
      shift: event.shiftKey,
      alt: event.altKey,
    }),
    primary: event.ctrlKey || event.metaKey,
    shift: event.shiftKey,
    alt: event.altKey,
  };
  return shortcut;
}

function normalizeShortcutKey(key: string) {
  if (key === " ") return "Space";
  if (key.length === 1) return key.toLowerCase();
  return key;
}

function displayShortcut(shortcut: Omit<EditorShortcut, "display">) {
  const parts = [];
  if (shortcut.primary) parts.push("Ctrl/Cmd");
  if (shortcut.shift) parts.push("Shift");
  if (shortcut.alt) parts.push("Alt");
  parts.push(shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key);
  return parts.join("+");
}
