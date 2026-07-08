export function extractMediaTags(text: string): string[] {
  const matches = text.matchAll(/MEDIA:([^\s"',}\]]+)/g);
  return Array.from(new Set(Array.from(matches, (match) => match[1])));
}

export function stripMediaTags(text: string): string {
  return text
    .replace(/MEDIA:([^\s"',}\]]+)/g, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

export function mediaKind(path: string): "image" | "audio" | "video" {
  const lower = path.toLowerCase();
  if (/\.(mp3|wav)$/.test(lower)) return "audio";
  if (/\.(mp4|webm)$/.test(lower)) return "video";
  return "image";
}
