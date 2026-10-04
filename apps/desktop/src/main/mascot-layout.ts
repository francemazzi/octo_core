export type Rect = { x: number; y: number; width: number; height: number };

/** The mascot window: the logo on the right, room on its left for the hover controls. */
export const MASCOT_SIZE = { width: 156, height: 84 } as const;
export const MASCOT_MARGIN = 8;

/** Top-right corner of the work area (below the menu bar, beside the Dock or taskbar). */
export function mascotBounds(
  workArea: Rect,
  size: { width: number; height: number } = MASCOT_SIZE,
  margin = MASCOT_MARGIN,
): Rect {
  return {
    x: Math.round(workArea.x + workArea.width - size.width - margin),
    y: Math.round(workArea.y + margin),
    width: size.width,
    height: size.height,
  };
}
