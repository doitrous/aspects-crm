const MAX_EXPORT_WIDTH = 1800;
const MAX_CANVAS_EDGE = 8192;
const MAX_CANVAS_AREA = 16_000_000;

/**
 * Keep report exports inside conservative Safari/iOS canvas limits. Oversized
 * canvases make `toBlob()` return null even when clipboard permission is valid.
 */
export function reportImageScale(width: number, height: number): number {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  return Math.max(0.05, Math.min(
    2,
    MAX_EXPORT_WIDTH / safeWidth,
    MAX_CANVAS_EDGE / safeWidth,
    MAX_CANVAS_EDGE / safeHeight,
    Math.sqrt(MAX_CANVAS_AREA / (safeWidth * safeHeight)),
  ));
}

export function reportImageDimensions(width: number, height: number): { width: number; height: number; scale: number } {
  const scale = reportImageScale(width, height);
  return {
    width: Math.max(1, Math.floor(Math.max(1, width) * scale)),
    height: Math.max(1, Math.floor(Math.max(1, height) * scale)),
    scale,
  };
}
