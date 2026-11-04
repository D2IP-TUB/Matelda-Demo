export interface Box { width: number; height: number }
export interface Rect { left: number; top: number; width: number; height: number }

/** Translation that moves the cell's centre onto the centre of the box. */
export function centerOffset(box: Box, cell: Rect): { x: number; y: number } {
  return {
    x: box.width / 2 - (cell.left + cell.width / 2),
    y: box.height / 2 - (cell.top + cell.height / 2),
  }
}
