import {
  type DragEvent,
  type RefObject,
  useRef,
  useState,
} from "react";
import { uploadDriveFiles } from "@/features/drive/api";
import { hasDraggedFiles } from "./attachmentUtils";
import type { ChatAttachment } from "../shared/types";

export function useChatAttachments({
  sessionId,
  inputRef,
  fileInputRef,
}: {
  sessionId: string | null;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
}) {
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attachmentSessionId, setAttachmentSessionId] = useState<string | null>(null);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const [attachmentError, setAttachmentError] = useState(false);
  const [dragDepth, setDragDepth] = useState(0);
  const attachmentSessionIdRef = useRef<string | null>(null);

  function setScopedAttachmentSessionId(nextSessionId: string | null) {
    attachmentSessionIdRef.current = nextSessionId;
    setAttachmentSessionId(nextSessionId);
  }

  const activeAttachments = attachmentSessionId === sessionId ? attachments : [];
  const activeUploadingAttachments =
    attachmentSessionId === sessionId && uploadingAttachments;
  const activeAttachmentError =
    attachmentSessionId === sessionId && attachmentError;
  const activeDragDepth = attachmentSessionId === sessionId ? dragDepth : 0;

  function clearAttachments() {
    setAttachments([]);
    setScopedAttachmentSessionId(null);
  }

  function removeAttachment(path: string) {
    setAttachments((current) =>
      current.filter((attachment) => attachment.path !== path),
    );
  }

  async function handleAttachmentFiles(files: FileList | File[]) {
    if (!sessionId) return;
    const targetSessionId = sessionId;
    const selected = Array.from(files).filter((file) => file.size > 0);
    if (selected.length === 0) return;

    setScopedAttachmentSessionId(targetSessionId);
    setUploadingAttachments(true);
    setAttachmentError(false);
    try {
      const targetPath = `/drive/shared/chat-attachments/${targetSessionId}`;
      const uploaded = await uploadDriveFiles(targetPath, selected);
      const nextFiles = uploaded.files.map((file) => ({
        name: file.name,
        path: file.path,
        mimeType: file.mimeType,
        size: file.size,
      }));
      setAttachments((current) =>
        attachmentSessionIdRef.current === targetSessionId
          ? [...current, ...nextFiles]
          : nextFiles,
      );
      setScopedAttachmentSessionId(targetSessionId);
      inputRef.current?.focus();
    } catch {
      setScopedAttachmentSessionId(targetSessionId);
      setAttachmentError(true);
    } finally {
      setUploadingAttachments(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setDragDepth(0);
    }
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event) || !sessionId) return;
    event.preventDefault();
    setScopedAttachmentSessionId(sessionId);
    setDragDepth((current) => current + 1);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    setDragDepth((current) => Math.max(0, current - 1));
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    setDragDepth(0);
    void handleAttachmentFiles(event.dataTransfer.files);
  }

  return {
    activeAttachments,
    activeUploadingAttachments,
    activeAttachmentError,
    activeDragDepth,
    clearAttachments,
    removeAttachment,
    handleAttachmentFiles,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
}
