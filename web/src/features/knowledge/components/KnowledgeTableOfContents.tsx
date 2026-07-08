import { useMemo } from "react";
import { Hash } from "lucide-react";
import { useTranslation } from "react-i18next";
import { extractHeadings, scrollToHeading } from "@/features/knowledge/utils";

export function TableOfContents({ content }: { content: string }) {
  const { t } = useTranslation();
  const items = useMemo(() => extractHeadings(content), [content]);

  if (items.length === 0) return null;

  return (
    <div className="hidden w-[220px] shrink-0 flex-col border-l border-[var(--border)] xl:flex">
      <div className="flex items-center gap-1.5 px-4 pb-2 pt-4 text-[11px] font-medium uppercase tracking-wide text-[var(--text-faint)]">
        <Hash size={12} />
        {t("knowledge.toc")}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <ul className="space-y-0.5">
          {items.map((item, i) => (
            <li key={i}>
              <button
                onClick={() => scrollToHeading(item.id)}
                className="block w-full truncate rounded px-2 py-1 text-left text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                style={{ paddingLeft: `${(item.level - 1) * 12 + 8}px` }}
                title={item.text}
              >
                {item.text}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
