import type { ChatAttachment } from "./types";

export function appendAttachmentsToMessage(
  text: string,
  attachments: ChatAttachment[],
): string {
  if (attachments.length === 0) return text;
  const lines = attachments.map((attachment) => {
    const mediaTag = isPreviewableAttachment(attachment)
      ? ` MEDIA:${attachment.path}`
      : "";
    return `- ${attachment.name} (${attachment.mimeType || "file"}, ${formatAttachmentSize(attachment.size)}): ${attachment.path}${mediaTag}`;
  });
  return [text, "", "첨부 파일:", ...lines]
    .filter((_, index) => text || index > 1)
    .join("\n");
}

export function hasDraggedFiles(event: React.DragEvent<HTMLDivElement>) {
  return Array.from(event.dataTransfer.types).includes("Files");
}

export function formatAttachmentSize(size: number) {
  const units = ["B", "KB", "MB", "GB"];
  let amount = size;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function isPreviewableAttachment(attachment: ChatAttachment) {
  return (
    attachment.mimeType.startsWith("image/") ||
    attachment.mimeType.startsWith("audio/") ||
    attachment.mimeType.startsWith("video/")
  );
}
