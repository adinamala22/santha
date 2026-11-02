import { describe, expect, it } from 'vitest';
import { addVertex, bounds, closeRing, moveVertex, openRing, type Position, removeVertex, ringProblems } from './polygon-edit';

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
