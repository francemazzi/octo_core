export type Os = "mac" | "win" | "linux";
export type Arch = "arm64" | "x64";
export type Target =
  "mac-arm64" | "mac-x64" | "win-x64" | "win-arm64" | "linux-x64" | "linux-arm64";
export type Lang = "it" | "en";
export type ReleaseAsset = { name: string; url: string; size: number };
export type SiteRelease = {
  version: string;
  tag: string;
  publishedAt: string;
  url: string;
  assets: ReleaseAsset[];
};
export type NavigatorLike = {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  userAgentData?: {
    platform?: string;
    getHighEntropyValues?: (
      hints: string[],
    ) => Promise<{ architecture?: string; bitness?: string }>;
  };
};
export const REPO: string;
export const LATEST_API: string;
export const TARGETS: Record<Target, { os: Os; arch: Arch; ext: "dmg" | "zip" }>;
export function detectOs(nav: NavigatorLike): Os | null;
export function detectArch(
  nav: NavigatorLike,
  os: Os | null,
  gpuRenderer?: () => string,
): Promise<{ arch: Arch; certain: boolean }>;
export function webglRenderer(doc: Document): string;
export function targetOf(assetName: string): Target | null;
export function assetsByTarget(release: SiteRelease | null): Partial<Record<Target, ReleaseAsset>>;
export function targetFor(os: Os, arch: Arch): Target | null;
export function pickAsset(
  release: SiteRelease | null,
  os: Os | null,
  arch: Arch,
): { target: Target; asset: ReleaseAsset } | null;
export function alternateTarget(target: Target): Target | null;
export function targetLabel(target: Target): string;
export function downloadLabel(target: Target | null, lang?: Lang): string;
export function formatSize(bytes: number, lang?: Lang): string;
export function compareVersions(a: string, b: string): number;
export function fromGithubRelease(body: unknown): SiteRelease | null;
