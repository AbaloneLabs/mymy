import {
  apiPreviewPathHref,
  processUrlBrowserSource,
} from "@/features/drive/browserSources";
import type { SandboxProcess } from "@/types/sandbox";

export const selectClassName =
  "h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-sm text-[var(--text)]";

export const inputClassName =
  "w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 font-mono text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-faint)] focus:border-[var(--accent)]";

export function processPreviewSource(process: SandboxProcess) {
  const url = processPreviewUrl(process);
  if (!url) return null;
  return processUrlBrowserSource(url, processPreviewLabel(process));
}

export function processPreviewUrl(process: SandboxProcess) {
  if (process.previewPath) return apiPreviewPathHref(process.previewPath);
  return process.previewTargetUrl ?? null;
}

function processPreviewLabel(process: SandboxProcess) {
  return (
    stringMetadata(process.metadata, "label") ??
    stringMetadata(process.metadata, "previewLabel") ??
    process.command
  );
}

function stringMetadata(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : null;
}

export function bytes(value?: number) {
  if (value === undefined) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}
