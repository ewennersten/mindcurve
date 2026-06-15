import type { Segment } from './state'

const CELL = 48
// Förskjutning så att celler strax utanför planen (negativa koordinater) får giltiga nycklar
const OFF = 16
const STRIDE = 4096

function cellKey(cx: number, cy: number): number {
  return (cx + OFF) * STRIDE + (cy + OFF)
}

/**
 * Spatial hash-grid över spårsegment. Håller kollisionskostnaden konstant
 * även när spåren blir tusentals segment långa.
 */
export class SegmentGrid {
  private cells = new Map<number, Segment[]>()

  insert(seg: Segment): void {
    const r = seg.radius
    const minX = Math.min(seg.x1, seg.x2) - r
    const maxX = Math.max(seg.x1, seg.x2) + r
    const minY = Math.min(seg.y1, seg.y2) - r
    const maxY = Math.max(seg.y1, seg.y2) + r
    const cx0 = Math.floor(minX / CELL)
    const cx1 = Math.floor(maxX / CELL)
    const cy0 = Math.floor(minY / CELL)
    const cy1 = Math.floor(maxY / CELL)
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const key = cellKey(cx, cy)
        let list = this.cells.get(key)
        if (!list) {
          list = []
          this.cells.set(key, list)
        }
        list.push(seg)
      }
    }
  }

  /** Alla segment vars celler täcks av cirkeln (kandidater, ej exakt träff). */
  queryCircle(x: number, y: number, r: number): Segment[] {
    const cx0 = Math.floor((x - r) / CELL)
    const cx1 = Math.floor((x + r) / CELL)
    const cy0 = Math.floor((y - r) / CELL)
    const cy1 = Math.floor((y + r) / CELL)
    const seen = new Set<Segment>()
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const list = this.cells.get(cellKey(cx, cy))
        if (list) for (const seg of list) seen.add(seg)
      }
    }
    return [...seen]
  }

  clear(): void {
    this.cells.clear()
  }
}

/** Träffar cirkeln (x, y, r) det tjocka segmentet? */
export function segCircleHit(seg: Segment, x: number, y: number, r: number): boolean {
  const dx = seg.x2 - seg.x1
  const dy = seg.y2 - seg.y1
  const lenSq = dx * dx + dy * dy
  let t = lenSq === 0 ? 0 : ((x - seg.x1) * dx + (y - seg.y1) * dy) / lenSq
  t = Math.min(Math.max(t, 0), 1)
  const px = seg.x1 + t * dx
  const py = seg.y1 + t * dy
  const ddx = x - px
  const ddy = y - py
  const hitDist = r + seg.radius
  return ddx * ddx + ddy * ddy < hitDist * hitDist
}
