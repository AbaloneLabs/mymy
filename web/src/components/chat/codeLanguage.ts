export function normalizeCodeLanguage(language?: string): string {
  const normalized = (language ?? "text").toLowerCase();
  const aliases: Record<string, string> = {
    js: "javascript",
    jsx: "jsx",
    ts: "typescript",
    tsx: "tsx",
    py: "python",
    rb: "ruby",
    sh: "bash",
    shell: "bash",
    zsh: "bash",
    yml: "yaml",
    md: "markdown",
    plaintext: "text",
    txt: "text",
  };
  return aliases[normalized] ?? normalized;
}

export function languageFromTitle(title: string): string {
  const extension = title.split(".").pop()?.toLowerCase();
  if (!extension || extension === title) return "text";
  return normalizeCodeLanguage(extension);
}
