import { useTranslation } from "react-i18next";
import type { JourneyQuery } from "@/features/journey/api";
import { Segmented } from "./Segmented";

type Filter = NonNullable<JourneyQuery["type"]>;
type Sort = NonNullable<JourneyQuery["sort"]>;

export function JourneyHeader({
  filter,
  sort,
  onFilterChange,
  onSortChange,
}: {
  filter: Filter;
  sort: Sort;
  onFilterChange: (value: Filter) => void;
  onSortChange: (value: Sort) => void;
}) {
  const { t } = useTranslation();
  return (
    <header className="border-b border-[var(--border)] px-6 py-3">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold text-[var(--text)]">
          {t("journey.title")}
        </h1>
        <div className="flex items-center gap-2">
          <Segmented
            value={filter}
            options={[
              ["all", t("journey.filters.all")],
              ["skill", t("journey.filters.skills")],
              ["memory", t("journey.filters.memories")],
            ]}
            onChange={(value) => onFilterChange(value as Filter)}
          />
          <select
            value={sort}
            onChange={(event) => onSortChange(event.target.value as Sort)}
            className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
          >
            <option value="recent">{t("journey.sort.recent")}</option>
            <option value="usage">{t("journey.sort.usage")}</option>
            <option value="name">{t("journey.sort.name")}</option>
          </select>
        </div>
      </div>
    </header>
  );
}
