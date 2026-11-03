import type { Page } from '@playwright/test';

// A 1×1 transparent PNG.
const BLANK = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

/**
 * Serve map tiles locally so the e2e suite does not depend on the public OSM tile server. MapLibre aborts
 * tile downloads mid-stream when the map re-fits, and real tile bodies that never finish keep the page from
 * ever reaching `networkidle`. The CSP is still exercised: the browser checks the tile URL before routing.
 */
export async function stubMapTiles(page: Page) {
  await page.route(/tile\.openstreetmap\.org\//, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: BLANK }));
}
