import { useState } from "react";
import { uploadDriveFiles } from "@/features/drive/api";
import { parentPath } from "@/features/drive/utils";
import { markdownRelativeFileReference } from "./markdownPreview";

type MarkdownImageActionsOptions = {
  filePath: string;
  insertSourceInline: (snippet: string) => void;
};

export function useMarkdownImageActions({
  filePath,
  insertSourceInline,
}: MarkdownImageActionsOptions) {
  const [imageDraft, setImageDraft] = useState("");
  const [imageAltDraft, setImageAltDraft] = useState("");
  const [imageInputOpen, setImageInputOpen] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);

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
    setUploadingImage(true);
    setImageUploadError(null);
    try {
      const uploaded = await uploadDriveFiles(parentPath(filePath), [file]);
      const entry = uploaded.files[0];
      if (!entry) return;
      insertImageReference(
        markdownRelativeFileReference(filePath, entry.path, entry.name),
        imageAltDraft.trim() || file.name.replace(/\.[^.]+$/, ""),
      );
    } catch (error) {
      setImageUploadError(error instanceof Error ? error.message : "Image upload failed");
    } finally {
      setUploadingImage(false);
    }
  }

  return {
    imageAltDraft,
    imageDraft,
    imageInputOpen,
    imageUploadError,
    setImageAltDraft,
    setImageDraft,
    setImageInputOpen,
    submitImage,
    uploadAndInsertImage,
    uploadingImage,
  };
}
