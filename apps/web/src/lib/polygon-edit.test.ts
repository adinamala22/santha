import { describe, expect, it } from 'vitest';
import { addVertex, bounds, circleRing, closeRing, moveVertex, openRing, type Position, removeVertex, ringProblems } from './polygon-edit';

const square: Position[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

describe('polygon editor helpers', () => {
  it('opens and closes rings', () => {
    expect(closeRing(square)).toHaveLength(5);
    expect(openRing(closeRing(square))).toEqual(square);
    expect(openRing(square)).toEqual(square); // already open
    expect(closeRing([])).toEqual([]);
  });

  it('adds, moves and removes vertices, rounding to 7 decimals like the API', () => {
    let r = addVertex([], [79.123456789, 14.987654321]);
    expect(r).toEqual([[79.1234568, 14.9876543]]);
    r = addVertex(r, [80, 15]);
    r = moveVertex(r, 0, [79.5, 14.5]);
    expect(r[0]).toEqual([79.5, 14.5]);
    expect(removeVertex(r, 0)).toEqual([[80, 15]]);
  });

  it('flags too few points and self-intersection (bow tie)', () => {
    expect(ringProblems(square.slice(0, 2))).toEqual(['tooFew']);
    expect(ringProblems(square)).toEqual([]);
    expect(
      ringProblems([
        [0, 0],
        [1, 1],
        [1, 0],
        [0, 1],
      ]),
    ).toEqual(['selfIntersects']);
  });

  it('computes bounds over several rings', () => {
    expect(bounds([square, [[2, -1]]])).toEqual([
      [0, -1],
      [2, 1],
    ]);
    expect(bounds([])).toBeNull();
  });
});

describe('circleRing (ADR-019)', () => {
  it('makes a valid open ring of points at the radius around the centre', () => {
    const centre = { lat: 14.4426, lng: 79.9865 };
    const ring = circleRing(centre, 3000);
    expect(ring).toHaveLength(48);
    expect(ringProblems(ring)).toEqual([]);
    const R = 6_371_008.8;
    const rad = (d: number) => (d * Math.PI) / 180;
    for (const [lng, lat] of ring) {
      const h = Math.sin(rad(lat - centre.lat) / 2) ** 2 + Math.cos(rad(centre.lat)) * Math.cos(rad(lat)) * Math.sin(rad(lng - centre.lng) / 2) ** 2;
      expect(2 * R * Math.asin(Math.sqrt(h))).toBeCloseTo(3000, -1);
    }
  });
});
