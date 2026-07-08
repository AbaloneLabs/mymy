import type { PptxChart } from "../shared/models";

type PptxChartSeriesActionParams = {
  activeChart: PptxChart | undefined;
  updateActiveChart: (patch: Partial<PptxChart>) => void;
};

export function createPptxChartSeriesActions({
  activeChart,
  updateActiveChart,
}: PptxChartSeriesActionParams) {
  function updateChartSeriesName(seriesIndex: number, value: string) {
    if (!activeChart) return;
    updateActiveChart({
      series: (activeChart.series ?? []).map((series, currentIndex) =>
        currentIndex === seriesIndex ? { ...series, name: value } : series,
      ),
    });
  }

  function updateChartSeriesPoint(
    seriesIndex: number,
    pointIndex: number,
    key: "categories" | "values",
    value: string,
  ) {
    if (!activeChart) return;
    updateActiveChart({
      series: (activeChart.series ?? []).map((series, currentIndex) => {
        if (currentIndex !== seriesIndex) return series;
        const nextValues = [...(series[key] ?? [])];
        nextValues[pointIndex] = value;
        return { ...series, [key]: nextValues };
      }),
    });
  }

  function addChartSeries() {
    if (!activeChart) return;
    const rowCount = activeChart.categories?.length ?? 0;
    updateActiveChart({
      series: [
        ...(activeChart.series ?? []),
        {
          categories: Array.from({ length: rowCount }, (_, index) =>
            activeChart.categories?.[index] ?? "",
          ),
          values: Array.from({ length: rowCount }, () => ""),
        },
      ],
    });
  }

  function deleteChartSeries(seriesIndex: number) {
    if (!activeChart) return;
    updateActiveChart({
      series: (activeChart.series ?? []).filter(
        (_series, currentIndex) => currentIndex !== seriesIndex,
      ),
    });
  }

  function addChartPoint(seriesIndex: number) {
    if (!activeChart) return;
    updateActiveChart({
      series: (activeChart.series ?? []).map((series, currentIndex) => {
        if (currentIndex !== seriesIndex) return series;
        return {
          ...series,
          categories: [
            ...(series.categories ?? activeChart.categories ?? []),
            "",
          ],
          values: [...(series.values ?? []), ""],
        };
      }),
    });
  }

  function deleteChartPoint(seriesIndex: number, pointIndex: number) {
    if (!activeChart) return;
    updateActiveChart({
      series: (activeChart.series ?? []).map((series, currentIndex) => {
        if (currentIndex !== seriesIndex) return series;
        return {
          ...series,
          categories: (series.categories ?? activeChart.categories ?? []).filter(
            (_category, currentPointIndex) => currentPointIndex !== pointIndex,
          ),
          values: (series.values ?? []).filter(
            (_value, currentPointIndex) => currentPointIndex !== pointIndex,
          ),
        };
      }),
    });
  }

  return {
    addChartPoint,
    addChartSeries,
    deleteChartPoint,
    deleteChartSeries,
    updateChartSeriesName,
    updateChartSeriesPoint,
  };
}
