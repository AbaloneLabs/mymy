export const ROOT_PATH = "/drive";

export function buildBreadcrumbs(path: string) {
  const parts = path.split("/").filter(Boolean);
  const crumbs = [{ label: "drive", path: ROOT_PATH }];
  let current = "";
  for (const part of parts.slice(1)) {
    current += `/${part}`;
    crumbs.push({ label: part, path: `${ROOT_PATH}${current}` });
  }
  return crumbs;
}

export function parentPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1) return ROOT_PATH;
  return `/${parts.slice(0, -1).join("/")}`;
}

export function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
