import { useRef } from "react";
import { FileDown, Loader2, Trash2, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { builtInFontFamilies } from "@/features/documentEditor/shared/fonts";
import { formatBytes, formatDate } from "@/features/drive/utils";
import type { EditorFont } from "@/types/editorSettings";

export function EditorFontSettingsSection({
  customFonts,
  loading,
  uploading,
  uploadError,
  deleting,
  onUploadFonts,
  onDeleteFont,
}: {
  customFonts: EditorFont[];
  loading: boolean;
  uploading: boolean;
  uploadError: boolean;
  deleting: boolean;
  onUploadFonts: (files: File[], onSettled: () => void) => void;
  onDeleteFont: (fontId: string) => void;
}) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function handleUpload(files: FileList | null) {
    const selected = Array.from(files ?? []);
    if (selected.length === 0) return;
    onUploadFonts(selected, () => {
      if (fileInputRef.current) fileInputRef.current.value = "";
    });
  }

  return (
    <>
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
            disabled={uploading}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-[var(--accent)] px-3 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
            ) : (
              <Upload className="h-4 w-4" strokeWidth={1.75} />
            )}
            {t("settings.editor.uploadFonts")}
          </button>
        </div>

        {uploadError && (
          <div className="rounded-md border border-[var(--status-error)]/40 bg-[var(--status-error)]/10 px-3 py-2 text-sm text-[var(--status-error)]">
            {t("settings.editor.uploadError")}
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
            {t("common.loading")}
          </div>
        )}

        {!loading && customFonts.length === 0 && (
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
                    onClick={() => onDeleteFont(font.id)}
                    disabled={deleting}
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
    </>
  );
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
