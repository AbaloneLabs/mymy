import type { Components } from "react-markdown";
import type { ElementType, ReactNode } from "react";
import { HighlightedCodeBlock } from "@/components/chat/shared/codeHighlight";
import { driveBlobUrl } from "@/features/drive/api";
import { parentPath } from "@/features/drive/utils";
import type { MarkdownHeadingAnchor } from "./markdownEditorUtils";

export function markdownPreviewComponents(
  filePath: string,
  onTaskListToggle: (line: number) => void,
  headingAnchors: MarkdownHeadingAnchor[] = [],
  onOpenDocument?: (path: string) => void,
): Components {
  const anchorByLine = new Map(headingAnchors.map((anchor) => [anchor.line, anchor.id]));
  const block = (Tag: ElementType) => {
    return function MarkdownPreviewBlock({
      node,
      children,
      className,
      ...props
    }: {
      node?: MarkdownPreviewNode;
      children?: ReactNode;
      className?: string;
    }) {
      return (
        <Tag
          {...props}
          {...markdownPreviewLineProps(node)}
          className={className}
        >
          {children}
        </Tag>
      );
    };
  };
  const heading = (level: 1 | 2 | 3 | 4 | 5 | 6) => {
    const Tag = `h${level}` as ElementType;
    return function MarkdownHeading({
      node,
      children,
      className,
      ...props
    }: {
      node?: { position?: { start?: { line?: number } } };
      children?: ReactNode;
      className?: string;
    }) {
      const line = node?.position?.start?.line;
      const id = typeof line === "number" ? anchorByLine.get(line) : undefined;
      return (
        <Tag
          {...props}
          id={id}
          data-markdown-line={line}
          className={[className, id ? "group scroll-mt-4" : ""].filter(Boolean).join(" ")}
        >
          {children}
          {id && (
            <a
              href={`#${id}`}
              className="ml-2 opacity-0 text-[var(--text-faint)] no-underline transition-opacity group-hover:opacity-100"
              aria-label="Link to heading"
            >
              #
            </a>
          )}
        </Tag>
      );
    };
  };
  return {
    h1: heading(1),
    h2: heading(2),
    h3: heading(3),
    h4: heading(4),
    h5: heading(5),
    h6: heading(6),
    p: block("p"),
    ul: block("ul"),
    ol: block("ol"),
    li: block("li"),
    blockquote: block("blockquote"),
    table: block("table"),
    thead: block("thead"),
    tbody: block("tbody"),
    tr: block("tr"),
    pre: block("pre"),
    code({ className, children, node, ...props }) {
      const match = /language-([\w-]+)/.exec(className ?? "");
      if (!match) {
        return (
          <code className={className} {...props} {...markdownPreviewLineProps(node)}>
            {children}
          </code>
        );
      }
      return (
        <div {...markdownPreviewLineProps(node)}>
          <HighlightedCodeBlock
            code={String(children).replace(/\n$/, "")}
            language={match[1]}
          />
        </div>
      );
    },
    a({ href, children, node, ...props }) {
      const resolved = resolveMarkdownReference(filePath, href);
      const external = isExternalReference(resolved.href);
      const openInEditor =
        onOpenDocument &&
        resolved.logicalPath &&
        isDocumentEditorReference(resolved.logicalPath);
      return (
        <a
          {...props}
          {...markdownPreviewLineProps(node)}
          href={resolved.href}
          onClick={
            openInEditor
              ? (event) => {
                  event.preventDefault();
                  onOpenDocument(resolved.logicalPath);
                }
              : props.onClick
          }
          rel={external ? "noreferrer" : undefined}
          target={external ? "_blank" : undefined}
        >
          {children}
        </a>
      );
    },
    img({ src, alt, node, ...props }) {
      const resolved = resolveMarkdownReference(filePath, src);
      return (
        <img
          {...props}
          {...markdownPreviewLineProps(node)}
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

interface MarkdownPreviewNode {
  position?: {
    start?: {
      line?: number;
    };
  };
}

function markdownPreviewLineProps(node: MarkdownPreviewNode | undefined) {
  const line = node?.position?.start?.line;
  return typeof line === "number" ? { "data-markdown-line": line } : {};
}

export function markdownRelativeFileReference(
  filePath: string,
  uploadedPath: string,
  uploadedName: string,
) {
  return parentPath(uploadedPath) === parentPath(filePath) ? uploadedName : uploadedPath;
}

function resolveMarkdownReference(filePath: string, value: string | undefined) {
  if (!value) return { href: undefined, logicalPath: undefined };
  if (isBrowserHandledReference(value)) return { href: value, logicalPath: undefined };
  const [pathAndQuery, fragment = ""] = value.split("#", 2);
  const [pathOnly, query = ""] = pathAndQuery.split("?", 2);
  const logicalPath = markdownReferencePath(filePath, pathOnly);
  if (!logicalPath) return { href: value, logicalPath: undefined };
  let href = driveBlobUrl(logicalPath);
  if (query) href = `${href}&${query}`;
  if (fragment) href = `${href}#${fragment}`;
  return { href, logicalPath };
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

function isDocumentEditorReference(path: string) {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return [
    "bash",
    "cjs",
    "css",
    "csv",
    "docx",
    "js",
    "json",
    "jsx",
    "md",
    "mjs",
    "pptx",
    "py",
    "rs",
    "sh",
    "sql",
    "toml",
    "ts",
    "tsx",
    "tsv",
    "txt",
    "xlsx",
    "xml",
    "yaml",
    "yml",
  ].includes(extension);
}
