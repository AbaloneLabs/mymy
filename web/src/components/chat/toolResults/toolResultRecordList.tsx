import { useState } from "react";
import { useTranslation } from "react-i18next";
import { firstString, isScalar } from "./toolResultUtils";
import { ExpandableFooter, MiniMeta } from "./toolResultShared";

export function CompactRecordList({
  title,
  records,
  primaryKeys,
  secondaryKeys,
  maxRows,
}: {
  title: string;
  records: Record<string, unknown>[];
  primaryKeys: string[];
  secondaryKeys: string[];
  maxRows: number;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const visibleRecords = expanded ? records : records.slice(0, maxRows);
  const hiddenCount = Math.max(records.length - visibleRecords.length, 0);

  if (records.length === 0) {
    return (
      <div className="mt-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text-muted)]">
        {title}: {t("chat.noResults")}
      </div>
    );
  }

  return (
    <div className="mt-2">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-[var(--text-faint)]">
        {title}
      </div>
      <div className="grid gap-2">
        {visibleRecords.map((record, index) => {
          const primary = firstString(record, primaryKeys) || `#${index + 1}`;
          const secondary = secondaryKeys
            .map((key) => {
              const value = record[key];
              if (isScalar(value)) return `${key}=${String(value)}`;
              return "";
            })
            .filter(Boolean)
            .slice(0, 4);
          return (
            <div
              key={`${primary}:${index}`}
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
            >
              <div className="break-words text-xs font-medium text-[var(--text)]">
                {primary}
              </div>
              {secondary.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {secondary.map((value) => (
                    <MiniMeta key={value} value={value} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <ExpandableFooter
        expanded={expanded}
        hiddenCount={hiddenCount}
        onToggle={() => setExpanded((current) => !current)}
      />
    </div>
  );
}
