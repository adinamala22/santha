import { serverApiUrl } from './api';

/** Public website settings from the API (ADR-023). */
export interface SiteConfig {
  /** Download buttons on (flag app_downloads). Off = "Launching soon on Android and iPhone". */
  appDownloads: boolean;
  androidUrl: string | null;
  iosUrl: string | null;
}

/** Until the API answers (or if it is down), the site stays in pre-launch mode: never a dead download link. */
export const PRE_LAUNCH: SiteConfig = { appDownloads: false, androidUrl: null, iosUrl: null };

/** GET /v1/config/site, cached for a minute so ops can switch downloads on without a redeploy. */
export async function getSiteConfig(): Promise<SiteConfig> {
  try {
    const res = await fetch(`${serverApiUrl()}/v1/config/site`, { next: { revalidate: 60 } });
    if (!res.ok) return PRE_LAUNCH;
    const c = (await res.json()) as Partial<SiteConfig>;
    return { appDownloads: c.appDownloads === true, androidUrl: c.androidUrl ?? null, iosUrl: c.iosUrl ?? null };
  } catch {
    return PRE_LAUNCH;
  }
}
