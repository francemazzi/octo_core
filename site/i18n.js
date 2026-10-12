/**
 * Two languages, one page: the HTML carries the Italian text, `EN` below replaces it key by
 * key, and switching back restores what the HTML had. Keys match `data-i18n` attributes;
 * `data-i18n-attr="aria-label:key"` translates attributes.
 */

const STORAGE_KEY = "octo_lang";

export const EN = {
  "meta.title": "Octo Core — document the work before automating it",
  "meta.description":
    "Octo Core records authorised work sessions, rebuilds the activities from the evidence and writes a DOCX report. Local by design, open source, signed and notarized. Free download for macOS, Windows and Linux.",
  "nav.download": "Download",
  "nav.github": "GitHub",
  "nav.lang": "Switch language",
  "hero.badge": "Octo Core {version} is out",
  "hero.meet": "Meet",
  "hero.sub": "From observed work to a documented process. Before automating.",
  "hero.all": "All downloads",
  "hero.alt": "{target} instead?",
  "hero.note": "Signed and notarized · GPL-3.0 · no account needed",
  "hero.phone": "Octo runs on computers: download it from macOS, Windows or Linux.",
  "hero.mockup": "The Octo dashboard with an analysed session",
  "how.title": "How it works",
  "how.1.title": "Recording with an always-visible mascot",
  "how.1.text":
    "Pick a screen, press Start. The octopus in the corner shows that Octo is recording; pause and stop stay one click away. No hidden recording, ever.",
  "how.2.title": "Activities rebuilt from the evidence",
  "how.2.text":
    "When you stop, the text read from the screens becomes activities with a name, a summary and a time: a union of intervals, never inflated sums.",
  "how.3.title": "Few questions, answers that count",
  "how.3.text":
    "At most three questions a day, only when the model is unsure. Your answer stays on the activity as the operator's statement, in the detail and in the report.",
  "how.4.title": "An assistant that cites its sources",
  "how.4.text":
    "Ask what happened in the session: every answer cites activities and screens, verified by the engine. Without evidence, the answer is flagged as unverified.",
  "how.5.title": "DOCX report and one folder per activity",
  "how.5.text":
    "Export a summary with times, evidence and statements, plus a folder per activity with its activity.json. Unclassified stretches go to a to-review folder.",
  "uses.title": "What it is for",
  "uses.1": "Order entry",
  "uses.2": "Document handling",
  "uses.3": "Item code lookup",
  "uses.4": "Email and replies",
  "uses.5": "Checks and reviews",
  "uses.6": "Process exceptions",
  "local.title": "Local by design",
  "local.text":
    "Octo records and analyses on your computer. The local model is Ollama on loopback; the cloud is used only when you ask, for one session, with the text of the approved screens and never the images. Open source under GPL-3.0.",
  "local.modes": "Data modes",
  "local.license": "License",
  "download.title": "Download Octo Core",
  "download.sub": "Version {version} · {date}",
  "download.loading": "Looking up the latest version…",
  "download.mac.note": "Signed with Developer ID and notarized by Apple.",
  "download.win.note":
    "Signed with Azure Artifact Signing. SmartScreen may still warn until the signature earns reputation.",
  "download.linux.note": "Zip archive, unsigned: compare the hash.",
  "download.checksums": "Verify the files with SHA256SUMS.txt",
  "download.reports": "Windows signing reports",
  "download.release": "Release notes on GitHub",
  "download.requirements":
    "To read the screens Octo needs Ollama and the local OCR model on the same computer.",
  "faq.title": "FAQ",
  "faq.1.q": "What leaves my computer?",
  "faq.1.a":
    "Nothing, by default. Recording, text extraction, analysis and export happen locally. A remote model receives only the text of the screens you approve, for one session, after an explicit confirmation; images never leave.",
  "faq.2.q": "Do I need an account?",
  "faq.2.a":
    "No. Octo has no login and no cloud account. Optional remote analysis uses your own OpenRouter or Anthropic key, stored in the system keystore.",
  "faq.3.q": "What do I need to read the screens?",
  "faq.3.a":
    "Ollama running on this computer with a local vision model (the OCR model) and a local chat model. Without them Octo still records, but activities are not recognised.",
  "faq.4.q": "Why does Windows show a warning?",
  "faq.4.a":
    "The Windows packages are signed, but a new signature has no SmartScreen reputation yet. Check the hash against SHA256SUMS.txt, then choose More info → Run anyway.",
  "faq.5.q": "Is it free?",
  "faq.5.a":
    "Yes. Octo Core is free software under GPL-3.0-or-later: you can use it, study it, change it and redistribute it under the same terms.",
  "faq.6.q": "Where is the source code?",
  "faq.6.a":
    "On GitHub, with the roadmap, the integration gates for every phase and the security documents.",
  "cta.title": "Document the work before automating it",
  "cta.sub": "One authorised session, a few questions, a verifiable report.",
  "footer.source": "Source on GitHub",
  "footer.license": "GPL-3.0-or-later license",
  "footer.docs": "Documentation",
  "footer.tux": "Tux by Larry Ewing",
  "footer.made": "Octo Core is free software. Trademarks belong to their owners.",
};

/** The language to show: the URL, then the stored choice, then the browser. */
export function pickLanguage(search, stored, browserLanguage) {
  const fromUrl = new URLSearchParams(search ?? "").get("lang");
  if (fromUrl === "it" || fromUrl === "en") return fromUrl;
  if (stored === "it" || stored === "en") return stored;
  return String(browserLanguage ?? "")
    .toLowerCase()
    .startsWith("it")
    ? "it"
    : "en";
}

export function createI18n(doc, storage) {
  const originals = new Map();
  let current = "it";

  function remember(element, key, attr) {
    const id = attr ? `${key}@${attr}` : key;
    if (!originals.has(id))
      originals.set(id, attr ? element.getAttribute(attr) : element.innerHTML);
    return originals.get(id);
  }

  function translate(element, key, attr, lang) {
    const original = remember(element, key, attr);
    const value = lang === "en" ? (EN[key] ?? original) : original;
    if (attr) element.setAttribute(attr, value ?? "");
    else element.innerHTML = value ?? "";
  }

  return {
    get lang() {
      return current;
    },
    text(key, lang = current) {
      if (lang === "en" && EN[key]) return EN[key];
      const element = doc.querySelector(`[data-i18n="${key}"]`);
      return element ? remember(element, key) : (EN[key] ?? key);
    },
    apply(lang) {
      current = lang;
      doc.documentElement.lang = lang;
      for (const element of doc.querySelectorAll("[data-i18n]")) {
        translate(element, element.getAttribute("data-i18n"), null, lang);
      }
      for (const element of doc.querySelectorAll("[data-i18n-attr]")) {
        for (const pair of element.getAttribute("data-i18n-attr").split(";")) {
          const [attr, key] = pair.split(":").map((part) => part.trim());
          if (attr && key) translate(element, key, attr, lang);
        }
      }
      for (const button of doc.querySelectorAll("[data-lang]")) {
        button.setAttribute("aria-pressed", String(button.getAttribute("data-lang") === lang));
      }
      try {
        storage?.setItem(STORAGE_KEY, lang);
      } catch {
        // Private mode or blocked storage: the choice simply does not persist.
      }
    },
    stored() {
      try {
        return storage?.getItem(STORAGE_KEY) ?? null;
      } catch {
        return null;
      }
    },
  };
}
