import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** What the landing page needs from the latest GitHub release, written to site/releases.json. */
export type SiteRelease = {
  version: string;
  tag: string;
  publishedAt: string;
  url: string;
  assets: Array<{ name: string; url: string; size: number }>;
};

const REPO = "francemazzi/octo_core";
const KEEP =
  /^(OctoCore-.*\.(dmg|zip)|SHA256SUMS\.txt|LICENSE|THIRD-PARTY-NOTICES\.txt|windows-signing-report-.*\.json)$/;

type ApiRelease = {
  tag_name: string;
  published_at: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  assets: Array<{ name: string; browser_download_url: string; size: number }>;
};

/** The latest published release, or the one of `tag`; a token (CI) lifts the anonymous rate limit. */
export async function fetchRelease(
  tag?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SiteRelease> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const path = tag ? `releases/tags/${encodeURIComponent(tag)}` : "releases/latest";
  const response = await fetchImpl(`https://api.github.com/repos/${REPO}/${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`GitHub releases answered ${response.status}`);
  return toSiteRelease((await response.json()) as ApiRelease);
}

export function toSiteRelease(release: ApiRelease): SiteRelease {
  if (release.draft || release.prerelease)
    throw new Error(`${release.tag_name} is not a published release`);
  return {
    version: release.tag_name.replace(/^v/, ""),
    tag: release.tag_name,
    publishedAt: release.published_at,
    url: release.html_url,
    assets: release.assets
      .filter((asset) => KEEP.test(asset.name))
      .map((asset) => ({ name: asset.name, url: asset.browser_download_url, size: asset.size }))
      .sort((a, b) => a.name.localeCompare(b.name, "en")),
  };
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (invokedDirectly) {
  const args = process.argv.slice(2);
  const tagIndex = args.indexOf("--tag");
  const release = await fetchRelease(tagIndex >= 0 ? args[tagIndex + 1] : undefined);
  const target = join(process.cwd(), "site", "releases.json");
  writeFileSync(target, `${JSON.stringify(release, null, 2)}\n`);
  process.stdout.write(`site/releases.json: ${release.tag} with ${release.assets.length} assets\n`);
}
