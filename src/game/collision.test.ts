import { describe, expect, it } from 'vitest'
import { SegmentGrid, segCircleHit } from './collision'
import type { Segment } from './state'

function seg(x1: number, y1: number, x2: number, y2: number, radius = 2): Segment {
  return { id: 1, playerId: 0, x1, y1, x2, y2, radius, endDist: 0 }
}

describe('segCircleHit', () => {
  it('träffar när cirkeln ligger på segmentet', () => {
    expect(segCircleHit(seg(0, 0, 100, 0), 50, 0, 2)).toBe(true)
  })

  it('träffar när cirkeln nuddar segmentets tjocklek från sidan', () => {
    // avstånd 3.5 < r(2) + segRadius(2)
    expect(segCircleHit(seg(0, 0, 100, 0), 50, 3.5, 2)).toBe(true)
  })

  it('missar när cirkeln är utanför tjockleken', () => {
    expect(segCircleHit(seg(0, 0, 100, 0), 50, 4.5, 2)).toBe(false)
  })

  it('hanterar ändpunkter korrekt', () => {
    expect(segCircleHit(seg(0, 0, 100, 0), 103, 0, 2)).toBe(true)
    expect(segCircleHit(seg(0, 0, 100, 0), 105, 0, 2)).toBe(false)
  })
})

describe('SegmentGrid', () => {
  it('hittar segment nära frågepunkten och inget långt bort', () => {
    const grid = new SegmentGrid()
    const a = seg(100, 100, 140, 100)
    grid.insert(a)
    expect(grid.queryCircle(120, 105, 5)).toContain(a)
    expect(grid.queryCircle(600, 600, 5)).toHaveLength(0)
  })

  it('hittar långa segment som spänner över flera celler', () => {
    const grid = new SegmentGrid()
    const long = seg(0, 50, 500, 50)
    grid.insert(long)
    expect(grid.queryCircle(250, 50, 3)).toContain(long)
    expect(grid.queryCircle(490, 52, 3)).toContain(long)
  })

  it('clear tömmer gridden', () => {
    const grid = new SegmentGrid()
    grid.insert(seg(10, 10, 20, 10))
    grid.clear()
    expect(grid.queryCircle(15, 10, 5)).toHaveLength(0)
  })
})
