import { lazy, Suspense } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { EditorCommandRequest } from "@/features/documentEditor/commands";
import {
  normalizeDelimitedTableModel,
  normalizeDocxModel,
  normalizePptxModel,
  normalizeTextModel,
  normalizeXlsxModel,
} from "@/features/documentEditor/models";
import type { DocumentEditorKind } from "@/types/documentEditor";

const MarkdownRichEditor = lazy(() =>
  import("@/features/documentEditor/editors/MarkdownEditor").then((module) => ({
    default: module.MarkdownRichEditor,
  })),
);
const PlainTextEditor = lazy(() =>
  import("@/features/documentEditor/editors/TextEditor").then((module) => ({
    default: module.PlainTextEditor,
  })),
);
const DocxEditor = lazy(() =>
  import("@/features/documentEditor/editors/WordEditor").then((module) => ({
    default: module.DocxEditor,
  })),
);
const DelimitedTableEditor = lazy(() =>
  import("@/features/documentEditor/editors/DelimitedTableEditor").then((module) => ({
    default: module.DelimitedTableEditor,
  })),
);
const XlsxEditor = lazy(() =>
  import("@/features/documentEditor/editors/SpreadsheetEditor").then((module) => ({
    default: module.XlsxEditor,
  })),
);
const PptxEditor = lazy(() =>
  import("@/features/documentEditor/editors/PresentationEditor").then((module) => ({
    default: module.PptxEditor,
  })),
);

export function DocumentEditorBody({
  path,
  kind,
  model,
  onChange,
  commandRequest,
  onCommandHandled,
  onOpenDocument,
}: {
  path: string;
  kind: DocumentEditorKind;
  model: unknown;
  onChange: (model: unknown) => void;
  commandRequest: EditorCommandRequest | null;
  onCommandHandled: (request: EditorCommandRequest) => void;
  onOpenDocument?: (path: string) => void;
}) {
  let editor: ReactNode = null;
  if (kind === "markdown") {
    editor = (
      <MarkdownRichEditor
        filePath={path}
        model={normalizeTextModel(model)}
        onChange={onChange}
        commandRequest={commandRequest}
        onCommandHandled={onCommandHandled}
        onOpenDocument={onOpenDocument}
      />
    );
  } else if (kind === "text") {
    editor = (
      <PlainTextEditor
        filePath={path}
        model={normalizeTextModel(model)}
        onChange={onChange}
        commandRequest={commandRequest}
        onCommandHandled={onCommandHandled}
      />
    );
  } else if (kind === "csv" || kind === "tsv") {
    editor = (
      <DelimitedTableEditor
        model={normalizeDelimitedTableModel(model)}
        onChange={onChange}
        commandRequest={commandRequest}
        onCommandHandled={onCommandHandled}
      />
    );
  } else if (kind === "docx") {
    editor = (
      <DocxEditor
        model={normalizeDocxModel(model)}
        onChange={onChange}
        commandRequest={commandRequest}
        onCommandHandled={onCommandHandled}
      />
    );
  } else if (kind === "xlsx") {
    editor = (
      <XlsxEditor
        model={normalizeXlsxModel(model)}
        onChange={onChange}
        commandRequest={commandRequest}
        onCommandHandled={onCommandHandled}
      />
    );
  } else if (kind === "pptx") {
    editor = (
      <PptxEditor
        model={normalizePptxModel(model)}
        onChange={onChange}
        commandRequest={commandRequest}
        onCommandHandled={onCommandHandled}
      />
    );
  }
  if (!editor) return null;
  return (
    <Suspense fallback={<DocumentEditorBodyFallback />}>
      {editor}
    </Suspense>
  );
}

function DocumentEditorBodyFallback() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-[var(--text-muted)]">
      {t("common.loading")}
    </div>
  );
}
