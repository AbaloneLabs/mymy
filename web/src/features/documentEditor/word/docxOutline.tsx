import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { DocxOutlineItem } from "./docxOutlineModel";

type DocxOutlinePanelProps = {
  activeBlockId?: string;
  items: DocxOutlineItem[];
  onClose: () => void;
  onFocusBlock: (blockId: string) => void;
};

export function DocxOutlinePanel({
  activeBlockId,
  items,
  onClose,
  onFocusBlock,
}: DocxOutlinePanelProps) {
  const { t } = useTranslation();
  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-[var(--border)] bg-[var(--bg)]">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--border)] px-3">
        <span className="text-xs font-semibold text-[var(--text)]">Outline</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        >
          {t("common.close")}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {items.length === 0 ? (
          <div className="rounded-md border border-dashed border-[var(--border)] px-3 py-8 text-center text-sm text-[var(--text-faint)]">
            No outline entries.
          </div>
        ) : (
          <div className="space-y-1">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onFocusBlock(item.id)}
                className={cn(
                  "block w-full rounded-md px-2 py-1.5 text-left hover:bg-[var(--surface-hover)]",
                  activeBlockId === item.id &&
                    "bg-[var(--surface-hover)] text-[var(--accent)]",
                )}
                style={{ paddingLeft: `${8 + Math.max(0, item.level - 1) * 12}px` }}
              >
                <div className="truncate text-xs font-medium text-[var(--text)]">
                  {item.label}
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-[var(--text-faint)]">
                  <span>{item.kind}</span>
                  <span>#{item.index + 1}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
