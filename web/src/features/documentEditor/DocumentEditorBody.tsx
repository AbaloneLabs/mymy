import type { EditorCommandRequest } from "@/features/documentEditor/commands";
import { MarkdownRichEditor } from "@/features/documentEditor/editors/MarkdownEditor";
import { PlainTextEditor } from "@/features/documentEditor/editors/TextEditor";
import { DocxEditor } from "@/features/documentEditor/editors/WordEditor";
import { DelimitedTableEditor } from "@/features/documentEditor/editors/DelimitedTableEditor";
import { XlsxEditor } from "@/features/documentEditor/editors/SpreadsheetEditor";
import { PptxEditor } from "@/features/documentEditor/editors/PresentationEditor";
import {
  normalizeDelimitedTableModel,
  normalizeDocxModel,
  normalizePptxModel,
  normalizeTextModel,
  normalizeXlsxModel,
} from "@/features/documentEditor/models";
import type { DocumentEditorKind } from "@/types/documentEditor";

export function DocumentEditorBody({
  path,
  kind,
  model,
  onChange,
  commandRequest,
  onCommandHandled,
}: {
  path: string;
  kind: DocumentEditorKind;
  model: unknown;
  onChange: (model: unknown) => void;
  commandRequest: EditorCommandRequest | null;
  onCommandHandled: (request: EditorCommandRequest) => void;
}) {
  if (kind === "markdown") {
    return (
      <MarkdownRichEditor
        filePath={path}
        model={normalizeTextModel(model)}
        onChange={onChange}
        commandRequest={commandRequest}
        onCommandHandled={onCommandHandled}
      />
    );
  }
  if (kind === "text") {
    return (
      <PlainTextEditor
        filePath={path}
        model={normalizeTextModel(model)}
        onChange={onChange}
        commandRequest={commandRequest}
        onCommandHandled={onCommandHandled}
      />
    );
  }
  if (kind === "csv" || kind === "tsv") {
    return (
      <DelimitedTableEditor
        model={normalizeDelimitedTableModel(model)}
        onChange={onChange}
        commandRequest={commandRequest}
        onCommandHandled={onCommandHandled}
      />
    );
  }
  if (kind === "docx") {
    return (
      <DocxEditor
        model={normalizeDocxModel(model)}
        onChange={onChange}
        commandRequest={commandRequest}
        onCommandHandled={onCommandHandled}
      />
    );
  }
  if (kind === "xlsx") {
    return (
      <XlsxEditor
        model={normalizeXlsxModel(model)}
        onChange={onChange}
        commandRequest={commandRequest}
        onCommandHandled={onCommandHandled}
      />
    );
  }
  if (kind === "pptx") {
    return (
      <PptxEditor
        model={normalizePptxModel(model)}
        onChange={onChange}
        commandRequest={commandRequest}
        onCommandHandled={onCommandHandled}
      />
    );
  }
  return null;
}

