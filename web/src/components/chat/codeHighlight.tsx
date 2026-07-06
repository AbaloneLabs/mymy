import { useEffect, useState } from "react";
import { Code2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { languageFromTitle, normalizeCodeLanguage } from "./codeLanguage";

export function CodeBlock({
  title,
  content,
  language,
  tone,
}: {
  title: string;
  content: string;
  language?: string;
  tone?: "error";
}) {
  return (
    <div className="mt-2 overflow-hidden rounded-md border border-[var(--border)]">
      <div className="flex items-center gap-1.5 border-b border-[var(--border)] bg-[var(--surface)] px-2 py-1 font-mono text-[10px] text-[var(--text-faint)]">
        <Code2 className="h-3 w-3" strokeWidth={1.5} />
        {title}
      </div>
      <HighlightedCodeBlock
        code={content}
        language={language ?? languageFromTitle(title)}
        tone={tone}
        compact
      />
    </div>
  );
}

export function HighlightedCodeBlock({
  code,
  language,
  tone,
  compact = false,
}: {
  code: string;
  language?: string;
  tone?: "error";
  compact?: boolean;
}) {
  const highlightKey = `${language ?? "text"}:${code}`;
  const [highlight, setHighlight] = useState<{ key: string; html: string } | null>(null);

  useEffect(() => {
    let active = true;
    const lang = normalizeCodeLanguage(language);

    void renderHighlightedCode(code, lang)
      .then((rendered) => {
        if (active) setHighlight({ key: highlightKey, html: rendered });
      })
      .catch(() => {
        if (active) setHighlight(null);
      });

    return () => {
      active = false;
    };
  }, [code, highlightKey, language]);

  if (highlight?.key === highlightKey) {
    return (
      <div
        className={cn(
          "shiki-code-block",
          compact ? "max-h-64" : "my-2 max-h-80",
        )}
        dangerouslySetInnerHTML={{ __html: highlight.html }}
      />
    );
  }

  return (
    <pre
      className={cn(
        "overflow-auto bg-[var(--bg)] p-3 font-mono text-[11px] leading-relaxed",
        compact ? "max-h-64" : "my-2 max-h-80 rounded-md border border-[var(--border)]",
        tone === "error" ? "text-[var(--status-error)]" : "text-[var(--text-muted)]",
      )}
    >
      <code>{code}</code>
    </pre>
  );
}

type ChatHighlighter = {
  codeToHtml: (code: string, options: { lang: string; theme: string }) => string;
};

const SHIKI_THEME = "github-dark";
const SUPPORTED_SHIKI_LANGUAGES = new Set([
  "bash",
  "css",
  "html",
  "javascript",
  "json",
  "jsx",
  "markdown",
  "python",
  "rust",
  "shellscript",
  "sql",
  "tsx",
  "typescript",
  "yaml",
]);

let chatHighlighterPromise: Promise<ChatHighlighter> | null = null;

function getChatHighlighter(): Promise<ChatHighlighter> {
  chatHighlighterPromise ??= Promise.all([
    import("shiki/core"),
    import("shiki/engine/javascript"),
    import("shiki/themes/github-dark.mjs"),
    import("shiki/langs/bash.mjs"),
    import("shiki/langs/css.mjs"),
    import("shiki/langs/html.mjs"),
    import("shiki/langs/javascript.mjs"),
    import("shiki/langs/json.mjs"),
    import("shiki/langs/jsx.mjs"),
    import("shiki/langs/markdown.mjs"),
    import("shiki/langs/python.mjs"),
    import("shiki/langs/rust.mjs"),
    import("shiki/langs/shellscript.mjs"),
    import("shiki/langs/sql.mjs"),
    import("shiki/langs/tsx.mjs"),
    import("shiki/langs/typescript.mjs"),
    import("shiki/langs/yaml.mjs"),
  ]).then(
    ([
      core,
      engine,
      theme,
      bash,
      css,
      html,
      javascript,
      json,
      jsx,
      markdown,
      python,
      rust,
      shellscript,
      sql,
      tsx,
      typescript,
      yaml,
    ]) =>
      core.createHighlighterCore({
        themes: [theme.default],
        langs: [
          ...bash.default,
          ...css.default,
          ...html.default,
          ...javascript.default,
          ...json.default,
          ...jsx.default,
          ...markdown.default,
          ...python.default,
          ...rust.default,
          ...shellscript.default,
          ...sql.default,
          ...tsx.default,
          ...typescript.default,
          ...yaml.default,
        ],
        engine: engine.createJavaScriptRegexEngine(),
      }),
  );
  return chatHighlighterPromise;
}

async function renderHighlightedCode(code: string, language: string): Promise<string> {
  const highlighter = await getChatHighlighter();
  const lang = SUPPORTED_SHIKI_LANGUAGES.has(language) ? language : "text";
  return highlighter.codeToHtml(code, { lang, theme: SHIKI_THEME });
}
