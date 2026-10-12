import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listFiles, sha256 } from "./artifacts.js";

const SCOPE = "https://codesigning.azure.net";
const ENDPOINT_PATTERN = /^https:\/\/[a-z0-9]+\.codesigning\.azure\.net\/?$/;
const TIMESTAMP_URL = "http://timestamp.acs.microsoft.com";
const SIGNABLE = [".exe", ".dll", ".node"] as const;
const TOKEN_ENV = "OCTO_AZURE_ACCESS_TOKEN";

type AzureSettings = { endpoint: string; account: string; profile: string };

const SETTING_NAMES: Array<{ key: keyof AzureSettings; name: string; legacy: string }> = [
  { key: "endpoint", name: "AZURE_ARTIFACT_SIGNING_ENDPOINT", legacy: "OCTO_AZURE_SIGNING_ENDPOINT" },
  { key: "account", name: "AZURE_ARTIFACT_SIGNING_ACCOUNT_NAME", legacy: "OCTO_AZURE_SIGNING_ACCOUNT" },
  {
    key: "profile",
    name: "AZURE_ARTIFACT_SIGNING_CERT_PROFILE_NAME",
    legacy: "OCTO_AZURE_SIGNING_PROFILE",
  },
];

/**
 * Azure Artifact Signing settings. Nothing set means "publish unsigned"; a partial set or a
 * malformed endpoint is a configuration error and stops the release.
 */
export function azureSigningSettings(): AzureSettings | undefined {
  const values = SETTING_NAMES.map((setting) => ({
    ...setting,
    value: process.env[setting.name] ?? process.env[setting.legacy],
  }));
  if (values.every((setting) => !setting.value)) return undefined;
  const missing = values.filter((setting) => !setting.value).map((setting) => setting.name);
  if (missing.length > 0) {
    throw new Error(`Windows signing is partially configured; missing ${missing.join(", ")}`);
  }
  const settings = Object.fromEntries(values.map((s) => [s.key, s.value])) as AzureSettings;
  if (!ENDPOINT_PATTERN.test(settings.endpoint)) {
    throw new Error("unexpected Azure Artifact Signing endpoint (expected https://<region>.codesigning.azure.net)");
  }
  return settings;
}

export function windowsSigningConfigured(): boolean {
  return azureSigningSettings() !== undefined;
}

export type SigningRecord = { path: string; sha256: string; action: string; verification: string };
export type SigningReport = {
  result: "passed" | "failed";
  tool: string;
  files: SigningRecord[];
  error?: string;
};

function commandAvailable(command: string): boolean {
  return spawnSync("which", [command], { stdio: "ignore" }).status === 0;
}

/** Windows hosts use signtool through the PowerShell port; the report comes back as JSON. */
function signWithSigntool(folder: string, reportPath: string): SigningReport {
  const shell = commandAvailable("pwsh") ? "pwsh" : "powershell";
  const script = join(import.meta.dirname, "..", "ci", "windows-signing-files.ps1");
  execFileSync(
    shell,
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Path", folder, "-ReportPath", reportPath],
    { stdio: "inherit" },
  );
  return JSON.parse(readFileSync(reportPath, "utf8")) as SigningReport;
}

/** Access token for the signing service, fetched right before use from the signed-in Azure CLI. */
function accessToken(): string {
  return execFileSync(
    "az",
    ["account", "get-access-token", "--resource", SCOPE, "--query", "accessToken", "-o", "tsv"],
    { encoding: "utf8" },
  ).trim();
}

function verifyWithOsslsigncode(file: string): string {
  const result = spawnSync("osslsigncode", ["verify", file], { encoding: "utf8" });
  if (result.status === 0) return "osslsigncode: signature verified";
  throw new Error(`osslsigncode verify failed for ${file}: ${result.stdout}${result.stderr}`);
}

/**
 * Authenticode-signs every .exe/.dll/.node with Azure Artifact Signing through Jsign, which
 * lets macOS and Linux hosts sign Windows binaries. The token never touches the command line.
 */
function signWithJsign(folder: string, settings: AzureSettings, reportPath: string): SigningReport {
  const jsign = process.env.OCTO_JSIGN ?? "jsign";
  if (!commandAvailable(jsign)) {
    throw new Error(`${jsign} is not on PATH; install it with: brew install jsign`);
  }
  const files = listFiles(folder, SIGNABLE);
  if (files.length === 0) throw new Error(`no Windows binaries to sign under ${folder}`);
  const canVerify = commandAvailable("osslsigncode");
  execFileSync(
    jsign,
    [
      "--storetype",
      "TRUSTEDSIGNING",
      "--keystore",
      settings.endpoint.replace(/^https:\/\//, "").replace(/\/$/, ""),
      "--storepass",
      `env:${TOKEN_ENV}`,
      "--alias",
      `${settings.account}/${settings.profile}`,
      "--alg",
      "SHA-256",
      "--tsaurl",
      TIMESTAMP_URL,
      "--tsmode",
      "RFC3161",
      "--replace",
      "--name",
      "Octo Core",
      ...files,
    ],
    { stdio: "inherit", env: { ...process.env, [TOKEN_ENV]: accessToken() } },
  );
  const report: SigningReport = {
    result: "passed",
    tool: "jsign",
    files: files.map((file) => ({
      path: file.slice(folder.length + 1).replaceAll("\\", "/"),
      sha256: sha256(file),
      action: "signed",
      verification: canVerify
        ? verifyWithOsslsigncode(file)
        : "verifica non disponibile su questo sistema (osslsigncode assente)",
    })),
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

/** Signs all Windows binaries under `folder` and writes a JSON report next to the packages. */
export function signWindowsFolder(folder: string, reportPath: string): SigningReport {
  const settings = azureSigningSettings();
  if (!settings) throw new Error("Windows signing is not configured");
  if (process.platform === "win32") return signWithSigntool(folder, reportPath);
  return signWithJsign(folder, settings, reportPath);
}
