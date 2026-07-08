import type { PptxAnimation } from "../shared/models";

export function pptxAnimationTimelineDuration(animations: PptxAnimation[]) {
  return Math.max(
    1000,
    ...animations.map(
      (animation) =>
        (animation.delayMs ?? 0) + Math.max(100, animation.durationMs ?? 500),
    ),
  );
}

export function pptxFormatMilliseconds(milliseconds: number) {
  const seconds = Math.max(0, Math.round(milliseconds / 100) / 10);
  return `${seconds.toFixed(seconds % 1 === 0 ? 0 : 1)}s`;
}
