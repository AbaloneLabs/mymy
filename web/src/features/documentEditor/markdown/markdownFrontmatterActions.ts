import type { Dispatch, SetStateAction } from "react";
import {
  addFrontmatterFieldBody,
  deleteFrontmatterFieldBody,
  replaceFrontmatterBody,
  updateFrontmatterFieldBody,
} from "./markdownEditorUtils";
import type {
  FrontmatterField,
  MarkdownFrontmatter,
} from "./markdownEditorUtils";
import type { MarkdownSidePanelKind } from "./markdownSidePanel";

type MarkdownFrontmatterActionParams = {
  content: string;
  frontmatter: MarkdownFrontmatter | null;
  frontmatterFields: FrontmatterField[];
  structuralEditBlockReason: string | null;
  newFrontmatterKey: string;
  newFrontmatterValue: string;
  setMode: Dispatch<SetStateAction<"source" | "preview">>;
  setNewFrontmatterKey: Dispatch<SetStateAction<string>>;
  setNewFrontmatterValue: Dispatch<SetStateAction<string>>;
  setSidePanel: Dispatch<SetStateAction<MarkdownSidePanelKind | null>>;
  updateContent: (content: string) => void;
};

export function createMarkdownFrontmatterActions({
  content,
  frontmatter,
  frontmatterFields,
  structuralEditBlockReason,
  newFrontmatterKey,
  newFrontmatterValue,
  setMode,
  setNewFrontmatterKey,
  setNewFrontmatterValue,
  setSidePanel,
  updateContent,
}: MarkdownFrontmatterActionParams) {
  function openFrontmatterPanel() {
    if (!frontmatter) {
      const prefix = content.length > 0 ? "\n\n" : "";
      updateContent(`---\n---\n${prefix}${content}`);
    }
    setSidePanel("frontmatter");
    setMode("source");
  }

  function updateFrontmatterBody(body: string) {
    const next = replaceFrontmatterBody(content, body);
    if (next) updateContent(next);
  }

  function updateFrontmatterField(lineIndex: number, key: string, value: string) {
    if (!frontmatter) return;
    const field = frontmatterFields.find((item) => item.lineIndex === lineIndex);
    if (!field) return;
    updateFrontmatterBody(
      updateFrontmatterFieldBody(frontmatter.content, frontmatter.marker, field, key, value),
    );
  }

  function deleteFrontmatterField(lineIndex: number) {
    if (!frontmatter || structuralEditBlockReason) return;
    const field = frontmatterFields.find((item) => item.lineIndex === lineIndex);
    if (!field) return;
    updateFrontmatterBody(
      deleteFrontmatterFieldBody(frontmatter.content, frontmatter.marker, field),
    );
  }

  function addFrontmatterField() {
    if (!frontmatter || structuralEditBlockReason) return;
    const cleanKey = newFrontmatterKey.trim();
    if (!cleanKey) return;
    updateFrontmatterBody(
      addFrontmatterFieldBody(
        frontmatter.content,
        frontmatter.marker,
        cleanKey,
        newFrontmatterValue,
      ),
    );
    setNewFrontmatterKey("");
    setNewFrontmatterValue("");
  }

  function removeFrontmatter() {
    if (!frontmatter) return;
    if (
      !globalThis.confirm(
        "Remove the complete frontmatter block? The document body will remain unchanged.",
      )
    ) {
      return;
    }
    updateContent(
      `${content.slice(0, frontmatter.start)}${content.slice(frontmatter.end)}`.replace(
        /^\s*\n/,
        "",
      ),
    );
  }

  return {
    addFrontmatterField,
    deleteFrontmatterField,
    openFrontmatterPanel,
    removeFrontmatter,
    updateFrontmatterBody,
    updateFrontmatterField,
  };
}
