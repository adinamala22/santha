import { describe, expect, it } from 'vitest';
import { circlePolygon, covers, distanceToPolygonMeters, type GeoPolygon, haversineMeters, interiorsOverlap, polygonProblems, rect } from './polygon';

const square = rect(0, 0, 1, 1);

describe('polygon geometry (fake-mode stand-in for PostGIS)', () => {
  it('validates shape', () => {
    expect(polygonProblems(square)).toEqual([]);
    const open: GeoPolygon = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] };
    expect(polygonProblems(open)).toContain('Ring must be closed (last point = first)');
    const bowtie: GeoPolygon = { type: 'Polygon', coordinates: [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]] };
    expect(polygonProblems(bowtie)).toContain('Ring must not intersect itself');
    const flat: GeoPolygon = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [2, 0], [0, 0]]] };
    expect(polygonProblems(flat)).toContain('Polygon has no area');
    expect(polygonProblems(rect(0, 95, 1, 96))).toContain('Coordinates out of range (expected [lng, lat])');
  });

  it('covers interior and boundary points like ST_Covers', () => {
    expect(covers(square, { lng: 0.5, lat: 0.5 })).toBe(true);
    expect(covers(square, { lng: 1, lat: 0.5 })).toBe(true); // on edge
    expect(covers(square, { lng: 0, lat: 0 })).toBe(true); // vertex
    expect(covers(square, { lng: 1.01, lat: 0.5 })).toBe(false);
  });

  it('detects interior overlap but not shared edges', () => {
    expect(interiorsOverlap(square, rect(0.5, 0.5, 2, 2))).toBe(true); // crossing
    expect(interiorsOverlap(square, rect(0.2, 0.2, 0.4, 0.4))).toBe(true); // contained
    expect(interiorsOverlap(rect(0.2, 0.2, 0.4, 0.4), square)).toBe(true); // contains
    expect(interiorsOverlap(square, rect(1, 0, 2, 1))).toBe(false); // shared edge
    expect(interiorsOverlap(square, rect(1, 1, 2, 2))).toBe(false); // touching corner
    expect(interiorsOverlap(square, rect(3, 3, 4, 4))).toBe(false);
  });

  it('measures distance in metres', () => {
    // Nellore: ~0.01° latitude ≈ 1.11 km
    expect(haversineMeters({ lat: 14.44, lng: 79.98 }, { lat: 14.45, lng: 79.98 })).toBeCloseTo(1112, -1);
  });
});

describe('distance to a service area, circle areas', () => {
  const box = rect(79.985, 14.445, 80.005, 14.46);
  it('is 0 inside and the distance to the nearest edge outside', () => {
    expect(distanceToPolygonMeters(box, { lat: 14.45, lng: 79.99 })).toBe(0);
    // 0.01° of latitude south of the bottom edge ≈ 1112 m
    expect(distanceToPolygonMeters(box, { lat: 14.435, lng: 79.995 })).toBeCloseTo(1112, -1);
    // diagonal from a corner
    const corner = distanceToPolygonMeters(box, { lat: 14.44, lng: 79.98 });
    expect(corner).toBeCloseTo(haversineMeters({ lat: 14.44, lng: 79.98 }, { lat: 14.445, lng: 79.985 }), -1);
  });

  it('a circle polygon is valid, covers its centre and points within the radius, not beyond', () => {
    const centre = { lat: 14.4426, lng: 79.9865 };
    const c = circlePolygon(centre, 3000);
    expect(polygonProblems(c)).toEqual([]);
    expect(c.coordinates[0]).toHaveLength(49);
    expect(covers(c, centre)).toBe(true);
    expect(covers(c, { lat: centre.lat + 0.025, lng: centre.lng })).toBe(true); // ~2.8 km north
    expect(covers(c, { lat: centre.lat + 0.03, lng: centre.lng })).toBe(false); // ~3.3 km north
    for (const [lng, lat] of c.coordinates[0]) expect(haversineMeters(centre, { lat, lng })).toBeCloseTo(3000, -1);
  });
});
