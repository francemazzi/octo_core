import {
  LATEST_API,
  TARGETS,
  alternateTarget,
  assetsByTarget,
  compareVersions,
  detectArch,
  detectOs,
  downloadLabel,
  formatSize,
  fromGithubRelease,
  pickAsset,
  targetLabel,
  webglRenderer,
} from "./download.js";
import { createI18n, pickLanguage } from "./i18n.js";

const RELEASES_PAGE = "https://github.com/francemazzi/octo_core/releases/latest";
const i18n = createI18n(document, window.localStorage);
const state = { release: null, os: null, arch: "x64", certain: false, lang: "it" };

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function fill(text, values) {
  return text.replace(/\{(\w+)\}/g, (match, key) => (key in values ? values[key] : match));
}

function formatDate(iso, lang) {
  if (!iso) return "";
  return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "it-IT", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}

/** Texts with {version}/{date}/{target} are kept as templates and filled at every render. */
function renderTemplates() {
  const values = {
    version: state.release?.version ?? "…",
    date: formatDate(state.release?.publishedAt, state.lang),
    target: "",
  };
  for (const element of $$("[data-template]")) {
    const key = element.getAttribute("data-i18n");
    if (!key || element.hasAttribute("data-alt-link")) continue;
    element.textContent = fill(i18n.text(key, state.lang), values);
  }
}

function renderHero() {
  const picked = pickAsset(state.release, state.os, state.arch);
  const label = downloadLabel(picked?.target ?? null, state.lang);
  const primary = $("[data-primary-download]");
  const secondary = $("[data-primary-download-secondary]");
  $("[data-download-label]").textContent = label;
  $("[data-download-label-secondary]").textContent = label;
  for (const glyph of $$("[data-os-glyph]")) {
    glyph.toggleAttribute("hidden", glyph.getAttribute("data-os-glyph") !== state.os);
  }
  const href = picked?.asset.url ?? "#download";
  primary.href = href;
  secondary.href = href;
  for (const element of [primary, secondary]) {
    if (picked) element.setAttribute("download", "");
    else element.removeAttribute("download");
  }
  const alt = picked ? alternateTarget(picked.target) : null;
  const altAsset = alt ? assetsByTarget(state.release)[alt] : null;
  const altBox = $("[data-alt-download]");
  altBox.hidden = !(altAsset && !state.certain);
  if (altAsset) {
    const link = $("[data-alt-link]");
    link.href = altAsset.url;
    link.textContent = fill(i18n.text("hero.alt", state.lang), { target: targetLabel(alt) });
  }
  $("[data-phone-note]").hidden = state.os !== null;
  for (const card of $$("[data-os-card]")) {
    card.setAttribute("data-detected", String(card.getAttribute("data-os-card") === state.os));
  }
}

function renderDownloads() {
  const byTarget = assetsByTarget(state.release);
  for (const row of $$("[data-target]")) {
    const target = row.getAttribute("data-target");
    const asset = byTarget[target];
    row.href = asset?.url ?? RELEASES_PAGE;
    row.querySelector("[data-file]").textContent = asset?.name ?? `.${TARGETS[target].ext}`;
    row.querySelector("[data-size]").textContent = asset ? formatSize(asset.size, state.lang) : "";
  }
  for (const link of $$("[data-asset-link]")) {
    const asset = state.release?.assets.find(
      (item) => item.name === link.getAttribute("data-asset-link"),
    );
    link.href = asset?.url ?? RELEASES_PAGE;
  }
  $("[data-release-link]").href = state.release?.url ?? RELEASES_PAGE;
}

function render() {
  renderTemplates();
  renderHero();
  renderDownloads();
}

async function loadRelease() {
  try {
    const response = await fetch("./releases.json", { cache: "no-cache" });
    if (response.ok) state.release = await response.json();
  } catch {
    // Without the file the links point at the releases page.
  }
  render();
  try {
    const response = await fetch(LATEST_API, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) return;
    const live = fromGithubRelease(await response.json());
    if (live && (!state.release || compareVersions(live.version, state.release.version) > 0)) {
      state.release = live;
      render();
    }
  } catch {
    // Rate limited or offline: the deployed releases.json stays.
  }
}

async function detect() {
  // `?target=win-arm64` previews the page as another computer would see it.
  const forced = new URLSearchParams(window.location.search).get("target");
  if (forced && TARGETS[forced]) {
    state.os = TARGETS[forced].os;
    state.arch = TARGETS[forced].arch;
    state.certain = true;
    render();
    return;
  }
  state.os = detectOs(navigator);
  const { arch, certain } = await detectArch(navigator, state.os, () => webglRenderer(document));
  state.arch = arch;
  state.certain = certain;
  render();
}

function setLanguage(lang) {
  state.lang = lang;
  i18n.apply(lang);
  render();
}

function watchHero() {
  const hero = $("#hero");
  if (!("IntersectionObserver" in window) || !hero) {
    document.body.classList.add("past-hero");
    return;
  }
  new IntersectionObserver(
    ([entry]) => document.body.classList.toggle("past-hero", !entry.isIntersecting),
    { rootMargin: "-80px 0px 0px 0px" },
  ).observe(hero);
}

for (const button of $$("[data-lang]")) {
  button.addEventListener("click", () => setLanguage(button.getAttribute("data-lang")));
}
setLanguage(pickLanguage(window.location.search, i18n.stored(), navigator.language));
watchHero();
void detect();
void loadRelease();
