/**
 * ats.ts
 *
 * Job boards (WeWorkRemotely, RemoteOK) give us a *listing* URL, not an
 * apply URL. Nearly every listing funnels into a hosted ATS — Greenhouse,
 * Lever, Ashby or Workable. This module resolves the listing to the real
 * apply URL and identifies which ATS is behind it, so the orchestrator can
 * route the job to a driver that knows the form.
 */

import * as cheerio from "cheerio";
import { logger } from "../utils/logger.js";
import { getJson } from "../utils/http.js";

export type AtsName = "greenhouse" | "lever" | "ashby" | "workable";

const ATS_PATTERNS: Array<{ ats: AtsName; re: RegExp }> = [
  { ats: "greenhouse", re: /(?:boards|job-boards)\.greenhouse\.io|greenhouse\.io\/embed/i },
  { ats: "lever",      re: /jobs\.lever\.co/i },
  { ats: "ashby",      re: /jobs\.ashbyhq\.com/i },
  { ats: "workable",   re: /\.workable\.com/i },
];

/** Identify the ATS behind a URL, or null if it is not one we can drive. */
export function detectAts(url: string): AtsName | null {
  if (!url) return null;
  for (const { ats, re } of ATS_PATTERNS) {
    if (re.test(url)) return ats;
  }
  return null;
}

/**
 * Follow a listing URL and pull out the external apply link.
 *
 * Returns the resolved URL plus the detected ATS. When the listing itself is
 * already an ATS page, it is returned unchanged. When no ATS link can be
 * found, `ats` is null and the caller should leave the job for manual review
 * rather than guessing at an unknown form.
 */
export async function resolveApplyUrl(
  listingUrl: string
): Promise<{ url: string; ats: AtsName | null }> {
  // Already pointing at an ATS — nothing to resolve.
  const direct = detectAts(listingUrl);
  if (direct) return { url: listingUrl, ats: direct };

  try {
    const res = await getJson<string>(listingUrl, {
      maxRedirects: 5,
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    if (res.status !== 200) {
      logger.warn(`[ats] ${listingUrl}: HTTP ${res.status}`);
      return { url: listingUrl, ats: null };
    }

    // A redirect chain may have landed us on the ATS directly.
    const finalUrl = res.finalUrl;
    const afterRedirect = detectAts(finalUrl);
    if (afterRedirect) return { url: finalUrl, ats: afterRedirect };

    const $ = cheerio.load(res.data);

    // Scan every outbound link for a known ATS host. Prefer links whose text
    // or class looks like an apply action, but fall back to any ATS link on
    // the page — listing pages rarely link to a second company's board.
    const candidates: Array<{ href: string; score: number }> = [];

    $("a[href]").each((_i, el) => {
      const href = $(el).attr("href") ?? "";
      if (!detectAts(href)) return;
      const text = ($(el).text() || "").toLowerCase();
      const cls = ($(el).attr("class") || "").toLowerCase();
      const looksLikeApply =
        text.includes("apply") || cls.includes("apply") || text.includes("position");
      candidates.push({ href, score: looksLikeApply ? 2 : 1 });
    });

    if (candidates.length > 0) {
      candidates.sort((a, b) => b.score - a.score);
      const best = candidates[0]!.href;
      const abs = best.startsWith("http") ? best : new URL(best, finalUrl).toString();
      return { url: abs, ats: detectAts(abs) };
    }

    return { url: finalUrl, ats: null };
  } catch (err) {
    logger.warn(`[ats] Could not resolve apply URL for ${listingUrl}: ${String(err)}`);
    return { url: listingUrl, ats: null };
  }
}
