import { Prisma } from '@prisma/client';

/**
 * PostGIS helpers. Geo columns are `geography` and are not Prisma-managed, so all geo access
 * goes through these SQL fragments. Coordinates are WGS84 (SRID 4326), lng first.
 */
export interface LatLng {
  lat: number;
  lng: number;
}

export const point = ({ lat, lng }: LatLng): Prisma.Sql =>
  Prisma.sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography`;

/** `column` lies within `polygonColumn` (both geography). */
export const within = (pt: LatLng, polygonColumn: Prisma.Sql): Prisma.Sql =>
  Prisma.sql`ST_Covers(${polygonColumn}, ${point(pt)})`;

/** `column` is within `meters` of `pt`. */
export const dWithin = (column: Prisma.Sql, pt: LatLng, meters: number): Prisma.Sql =>
  Prisma.sql`ST_DWithin(${column}, ${point(pt)}, ${meters})`;

export const distanceMeters = (column: Prisma.Sql, pt: LatLng): Prisma.Sql =>
  Prisma.sql`ST_Distance(${column}, ${point(pt)})`;
