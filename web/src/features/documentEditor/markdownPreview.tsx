import type { Components } from "react-markdown";
import { HighlightedCodeBlock } from "@/components/chat/codeHighlight";
import { driveBlobUrl } from "@/features/drive/api";
import { parentPath } from "@/features/drive/utils";

export function markdownPreviewComponents(
  filePath: string,
  onTaskListToggle: (line: number) => void,
): Components {
  return {
    code({ className, children, ...props }) {
      const match = /language-([\w-]+)/.exec(className ?? "");
      if (!match) {
        return (
          <code className={className} {...props}>
            {children}
          </code>
        );
      }
      return (
        <HighlightedCodeBlock
          code={String(children).replace(/\n$/, "")}
          language={match[1]}
        />
      );
    },
    a({ href, children, ...props }) {
      const resolved = resolveMarkdownReference(filePath, href);
      const external = isExternalReference(resolved.href);
      return (
        <a
          {...props}
          href={resolved.href}
          rel={external ? "noreferrer" : undefined}
          target={external ? "_blank" : undefined}
        >
          {children}
        </a>
      );
    },
    img({ src, alt, ...props }) {
      const resolved = resolveMarkdownReference(filePath, src);
      return (
        <img
          {...props}
          alt={alt ?? ""}
          className="max-w-full rounded-md border border-[var(--border)]"
          src={resolved.href}
        />
      );
    },
    input({ type, checked, node, ...props }) {
      const line = node?.position?.start.line;
      if (type !== "checkbox" || typeof line !== "number") {
        return <input {...props} type={type} checked={checked} />;
      }
      return (
        <input
          {...props}
          type="checkbox"
          checked={Boolean(checked)}
          disabled={false}
          className="mr-1 align-middle"
          onChange={() => onTaskListToggle(line)}
        />
      );
    },
  };
}

export function markdownRelativeFileReference(
  filePath: string,
  uploadedPath: string,
  uploadedName: string,
) {
  return parentPath(uploadedPath) === parentPath(filePath) ? uploadedName : uploadedPath;
}

function resolveMarkdownReference(filePath: string, value: string | undefined) {
  if (!value) return { href: undefined };
  if (isBrowserHandledReference(value)) return { href: value };
  const [pathAndQuery, fragment = ""] = value.split("#", 2);
  const [pathOnly, query = ""] = pathAndQuery.split("?", 2);
  const logicalPath = markdownReferencePath(filePath, pathOnly);
  if (!logicalPath) return { href: value };
  let href = driveBlobUrl(logicalPath);
  if (query) href = `${href}&${query}`;
  if (fragment) href = `${href}#${fragment}`;
  return { href };
}

function markdownReferencePath(filePath: string, reference: string) {
  if (!reference) return null;
  if (reference.startsWith("/drive/")) return normalizeDriveReference(reference);
  if (reference.startsWith("/")) return null;
  return normalizeDriveReference(`${parentPath(filePath)}/${reference}`);
}

function normalizeDriveReference(value: string) {
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length > 1) parts.pop();
      continue;
    }
    parts.push(part);
  }
  if (parts[0] !== "drive") return null;
  return `/${parts.join("/")}`;
}

function isBrowserHandledReference(value: string) {
  return (
    value.startsWith("#") ||
    /^[a-z][a-z0-9+.-]*:/i.test(value) ||
    value.startsWith("//")
  );
}

function isExternalReference(value: string | undefined) {
  return Boolean(value && (/^https?:\/\//i.test(value) || value.startsWith("//")));
}
