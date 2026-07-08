import type { PptxLayout, PptxMaster, PptxTableStyle, PptxTheme } from "../../shared/models";
import { hexColorField, isRecord } from "../shared";
import { normalizePptxText } from "./slide";

export function normalizePptxLayout(value: unknown): PptxLayout | null {
  if (!isRecord(value) || typeof value.path !== "string") return null;
  return {
    path: value.path,
    name: typeof value.name === "string" ? value.name : undefined,
    type: typeof value.type === "string" ? value.type : undefined,
    masterPath: typeof value.masterPath === "string" ? value.masterPath : undefined,
    masterName: typeof value.masterName === "string" ? value.masterName : undefined,
    themePath: typeof value.themePath === "string" ? value.themePath : undefined,
    themeName: typeof value.themeName === "string" ? value.themeName : undefined,
    placeholderTexts: Array.isArray(value.placeholderTexts)
      ? value.placeholderTexts.map((text, index) => normalizePptxText(text, index))
      : undefined,
  };
}

export function normalizePptxMaster(value: unknown): PptxMaster | null {
  if (!isRecord(value) || typeof value.path !== "string") return null;
  return {
    path: value.path,
    name: typeof value.name === "string" ? value.name : undefined,
    themePath: typeof value.themePath === "string" ? value.themePath : undefined,
    themeName: typeof value.themeName === "string" ? value.themeName : undefined,
    placeholderTexts: Array.isArray(value.placeholderTexts)
      ? value.placeholderTexts.map((text, index) => normalizePptxText(text, index))
      : undefined,
  };
}

export function normalizePptxTheme(value: unknown): PptxTheme | null {
  if (!isRecord(value) || typeof value.path !== "string") return null;
  const colors = isRecord(value.colors)
    ? Object.fromEntries(
        Object.entries(value.colors)
          .map(([key, color]) => [key, hexColorField(color)] as const)
          .filter((entry): entry is readonly [string, string] => entry[1] !== undefined),
      )
    : undefined;
  return {
    path: value.path,
    name: typeof value.name === "string" ? value.name : undefined,
    colors: colors && Object.keys(colors).length > 0 ? colors : undefined,
    majorFont:
      typeof value.majorFont === "string" ? value.majorFont : undefined,
    minorFont:
      typeof value.minorFont === "string" ? value.minorFont : undefined,
  };
}

export function normalizePptxTableStyle(value: unknown): PptxTableStyle | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  return {
    id: value.id,
    name: typeof value.name === "string" ? value.name : undefined,
    default: typeof value.default === "boolean" ? value.default : undefined,
  };
}
