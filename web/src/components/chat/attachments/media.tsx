import { API_BASE } from "@/lib/api";
import { driveBlobUrl } from "@/features/drive/api";
import { extractMediaTags, mediaKind } from "./mediaTags";

export function MediaTagList({ text }: { text: string }) {
  const tags = extractMediaTags(text);
  if (tags.length === 0) return null;
  return (
    <div className="mt-2 grid gap-2">
      {tags.map((path) => (
        <MediaPreview key={path} path={path} />
      ))}
    </div>
  );
}

function MediaPreview({ path }: { path: string }) {
  const src = path.startsWith("/drive/")
    ? driveBlobUrl(path)
    : `${API_BASE}/media?path=${encodeURIComponent(path)}`;
  const kind = mediaKind(path);
  if (kind === "audio") {
    return <audio controls src={src} className="w-full" />;
  }
  if (kind === "video") {
    return (
      <video
        controls
        src={src}
        className="max-h-80 w-full rounded-md border border-[var(--border)]"
      />
    );
  }
  return (
    <img
      src={src}
      alt=""
      className="max-h-80 rounded-md border border-[var(--border)] object-contain"
    />
  );
}
