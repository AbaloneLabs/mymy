import { useTranslation } from "react-i18next";
import type {
  DocumentEditorKind,
  DocumentEditorSyncStatus,
} from "@/types/documentEditor";
import {
  documentEditorKindLabel,
  documentEditorStatusItems,
} from "./documentEditorStatusItems";

export function DocumentEditorStatusBar({
  kind,
  model,
  fingerprint,
  dirty,
  operationCount,
  selectionLabel,
  isSaving,
  isSaveQueued,
  warningCount,
  syncStatus,
  validatedDraftSerializedSize,
}: {
  kind: DocumentEditorKind;
  model: unknown;
  fingerprint: string;
  dirty: boolean;
  operationCount: number;
  selectionLabel: string;
  isSaving: boolean;
  isSaveQueued: boolean;
  warningCount: number;
  syncStatus: DocumentEditorSyncStatus;
  validatedDraftSerializedSize: number | null;
}) {
  const { t } = useTranslation();
  const statusItems = documentEditorStatusItems(kind, model);
  return (
    <div className="flex min-h-8 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--border)] bg-[var(--surface)] px-4 py-1.5 text-[11px] text-[var(--text-muted)]">
      <span className="font-medium text-[var(--text)]">
        {documentEditorKindLabel(kind)}
      </span>
      <span>
        {isSaving
          ? t("documentEditor.saving", { defaultValue: "Saving" })
          : isSaveQueued
            ? t("documentEditor.saveQueued", { defaultValue: "Save queued" })
            : dirty
            ? t("documentEditor.unsaved")
            : t("documentEditor.saved", { defaultValue: "Saved" })}
      </span>
      <span className="font-mono text-[var(--text-faint)]">
        {t("documentEditor.revision", { defaultValue: "rev" })}{" "}
        {fingerprint.slice(0, 10)}
      </span>
      <span
        className={
          syncStatus === "failed"
            ? "text-[var(--status-warning)]"
            : "text-[var(--text-faint)]"
        }
      >
        {syncStatus === "localOnly"
          ? "Local only"
          : syncStatus === "pending"
            ? "Remote sync pending"
            : syncStatus === "synced"
              ? "Remote synced"
              : "Remote sync unavailable"}
      </span>
      {validatedDraftSerializedSize !== null && (
        <span className="text-[var(--text-faint)]">
          Validated output {validatedDraftSerializedSize.toLocaleString()} bytes
        </span>
      )}
      <span>
        {t("documentEditor.operations", {
          defaultValue: "{{count}} operations",
          count: operationCount,
        })}
      </span>
      <span className="truncate">
        {t("documentEditor.selection", {
          defaultValue: "Selection: {{selection}}",
          selection: selectionLabel,
        })}
      </span>
      {warningCount > 0 && (
        <span className="text-[var(--status-warning)]">
          {t("documentEditor.compatibilityWarningCount", {
            defaultValue: "{{count}} compatibility warnings",
            count: warningCount,
          })}
        </span>
      )}
      {statusItems.map((item) => (
        <span key={item} className="truncate">
          {item}
        </span>
      ))}
    </div>
  );
}
