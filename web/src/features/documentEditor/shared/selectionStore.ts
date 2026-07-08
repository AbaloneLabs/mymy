import type { DocumentEditorKind } from "@/types/documentEditor";

export type EditorSelectionSnapshot =
  | {
      kind: "text";
      anchorOffset: number;
      focusOffset: number;
      selectedText: string;
      label: string;
    }
  | {
      kind: "element";
      role: DocumentEditorKind;
      label: string;
    }
  | {
      kind: "none";
      label: string;
    };

/**
 * The format-specific editors still own their rich selection models. This DOM
 * bridge gives the shared shell a stable, low-cost selection snapshot today and
 * leaves room for each editor to publish richer grid, slide, and structured-data
 * selections through the same shape later.
 */
export function captureEditorSelection(
  root: HTMLElement | null,
  role: DocumentEditorKind,
): EditorSelectionSnapshot {
  if (!root) return noneSelection();
  const selection = window.getSelection();
  if (
    selection &&
    selection.rangeCount > 0 &&
    selection.anchorNode &&
    selection.focusNode &&
    root.contains(selection.anchorNode) &&
    root.contains(selection.focusNode)
  ) {
    const selectedText = selection.toString();
    return {
      kind: "text",
      anchorOffset: selection.anchorOffset,
      focusOffset: selection.focusOffset,
      selectedText,
      label:
        selectedText.length > 0
          ? `${selectedText.length} selected`
          : "Text caret",
    };
  }
  const active = document.activeElement;
  if (active instanceof HTMLElement && root.contains(active)) {
    const label =
      active.getAttribute("aria-label") ??
      active.getAttribute("title") ??
      active.dataset.docxBlock ??
      active.dataset.markdownLine ??
      active.dataset.selectionKey ??
      active.tagName.toLowerCase();
    return { kind: "element", role, label };
  }
  return noneSelection();
}

function noneSelection(): EditorSelectionSnapshot {
  return { kind: "none", label: "No selection" };
}
