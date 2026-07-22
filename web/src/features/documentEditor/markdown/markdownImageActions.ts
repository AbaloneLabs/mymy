import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  deleteDrivePath,
  uploadDriveFiles,
} from "@/features/drive/api";
import { parentPath } from "@/features/drive/utils";
import { createUuid } from "@/lib/uuid";
import { markdownRelativeFileReference } from "./markdownPreview";
import {
  rebaseMarkdownSourceAnchor,
  type MarkdownSourceAnchor,
} from "./markdownSourceAnchor";

export type MarkdownPendingImageOperation = {
  id: string;
  label: string;
  status: "uploading" | "cancelling";
};

type InternalMarkdownImageOperation = MarkdownPendingImageOperation & {
  anchor: MarkdownSourceAnchor;
  cancelled: boolean;
  documentPath: string;
  uploadedPath?: string;
};

type MarkdownImageActionsOptions = {
  content: string;
  filePath: string;
  sourceRef: RefObject<HTMLTextAreaElement | null>;
  insertSourceInline: (snippet: string) => void;
  commitUploadedContent: (content: string) => void;
};

export function useMarkdownImageActions({
  content,
  filePath,
  sourceRef,
  insertSourceInline,
  commitUploadedContent,
}: MarkdownImageActionsOptions) {
  const [imageDraft, setImageDraft] = useState("");
  const [imageAltDraft, setImageAltDraft] = useState("");
  const [imageInputOpen, setImageInputOpen] = useState(false);
  const [pendingImageOperations, setPendingImageOperations] = useState<
    MarkdownPendingImageOperation[]
  >([]);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);
  const [imageOperationMessage, setImageOperationMessage] = useState<string | null>(null);
  const contentRef = useRef(content);
  const filePathRef = useRef(filePath);
  const operationsRef = useRef(new Map<string, InternalMarkdownImageOperation>());

  useEffect(() => {
    if (contentRef.current !== content) {
      rebasePendingImageOperations(contentRef.current, content);
    }
    filePathRef.current = filePath;
  }, [content, filePath]);

  useEffect(() => {
    const operations = operationsRef.current;
    return () => {
      operations.forEach((operation) => {
        operation.cancelled = true;
      });
    };
  }, []);

  function publishPendingOperations() {
    setPendingImageOperations(
      [...operationsRef.current.values()].map(({ id, label, status }) => ({
        id,
        label,
        status,
      })),
    );
  }

  function rebasePendingImageOperations(before: string, after: string) {
    if (before === after) return;
    operationsRef.current.forEach((operation) => {
      operation.anchor = rebaseMarkdownSourceAnchor(
        operation.anchor,
        before,
        after,
      );
    });
    contentRef.current = after;
  }

  function insertImageReference(src: string, altText: string) {
    insertSourceInline(`![${altText}](${src})`);
    setImageInputOpen(false);
    setImageDraft("");
    setImageAltDraft("");
    setImageUploadError(null);
  }

  function submitImage() {
    const src = imageDraft.trim();
    if (!src) return;
    insertImageReference(src, imageAltDraft.trim());
  }

  async function uploadAndInsertImage(file: File) {
    if (!file.type.startsWith("image/")) return;
    const selection = sourceRef.current;
    const anchor = {
      start: selection?.selectionStart ?? contentRef.current.length,
      end: selection?.selectionEnd ?? contentRef.current.length,
      affinity: "right" as const,
    };
    const id = `md-${createUuid()}`;
    const operation: InternalMarkdownImageOperation = {
      id,
      label: `Upload ${file.name}`,
      status: "uploading",
      anchor,
      cancelled: false,
      documentPath: filePathRef.current,
    };
    operationsRef.current.set(id, operation);
    publishPendingOperations();
    setImageUploadError(null);
    setImageOperationMessage(null);
    const altText = imageAltDraft.trim() || file.name.replace(/\.[^.]+$/, "");
    try {
      const uploaded = await uploadDriveFiles(parentPath(operation.documentPath), [file], {
        idempotencyKey: id,
      });
      const entry = uploaded.files[0];
      if (!entry) throw new Error("Image upload returned no file");
      operation.uploadedPath = entry.path;
      if (
        operation.cancelled ||
        filePathRef.current !== operation.documentPath ||
        !operationsRef.current.has(id)
      ) {
        await cleanupCancelledUpload(operation, entry.path);
        return;
      }
      const snippet = `![${altText}](${markdownRelativeFileReference(
        operation.documentPath,
        entry.path,
        entry.name,
      )})`;
      const latest = contentRef.current;
      const start = Math.max(0, Math.min(operation.anchor.start, latest.length));
      const end = Math.max(start, Math.min(operation.anchor.end, latest.length));
      operationsRef.current.delete(id);
      publishPendingOperations();
      const next = `${latest.slice(0, start)}${snippet}${latest.slice(end)}`;
      commitUploadedContent(next);
      setImageInputOpen(false);
      setImageDraft("");
      setImageAltDraft("");
      setImageOperationMessage(`Inserted ${entry.name} at the reviewed source anchor`);
    } catch (error) {
      operationsRef.current.delete(id);
      publishPendingOperations();
      if (!operation.cancelled) {
        setImageUploadError(
          error instanceof Error ? error.message : "Image upload failed",
        );
      }
    }
  }

  function cancelImageOperation(id: string) {
    const operation = operationsRef.current.get(id);
    if (!operation) return;
    operation.cancelled = true;
    operation.status = "cancelling";
    publishPendingOperations();
    setImageOperationMessage(
      `Cancelling ${operation.label}; any completed upload will be moved to trash`,
    );
    if (operation.uploadedPath) {
      void cleanupCancelledUpload(operation, operation.uploadedPath);
    }
  }

  async function cleanupCancelledUpload(
    operation: InternalMarkdownImageOperation,
    uploadedPath: string,
  ) {
    try {
      await deleteDrivePath(uploadedPath);
      setImageOperationMessage(
        `Cancelled ${operation.label}; uploaded file moved to trash`,
      );
    } catch {
      setImageOperationMessage(
        `Cancelled insertion, but retained uploaded file at ${uploadedPath}`,
      );
    } finally {
      operationsRef.current.delete(operation.id);
      publishPendingOperations();
    }
  }

  return {
    cancelImageOperation,
    imageAltDraft,
    imageDraft,
    imageInputOpen,
    imageOperationMessage,
    imageUploadError,
    pendingImageOperations,
    rebasePendingImageOperations,
    setImageAltDraft,
    setImageDraft,
    setImageInputOpen,
    setImageOperationMessage,
    submitImage,
    uploadAndInsertImage,
    uploadingImage: pendingImageOperations.length > 0,
  };
}
