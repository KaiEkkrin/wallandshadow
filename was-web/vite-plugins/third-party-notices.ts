import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { init, type ModuleInfos } from 'license-checker-rseidelsohn';
import type { Plugin } from 'vite';

// The acknowledgements page (`src/About.tsx`) imports this virtual module and
// splices its content into the THIRD-PARTY-NOTICES block of acknowledgements.md.
// Exposing the notices as a virtual module — rather than writing a file to disk —
// means the same code path runs in `vite dev` and `vite build`, there is nothing
// to .gitignore, and (because About is lazy-loaded) the generated string lands
// only in the lazy About chunk, not the main bundle.
const VIRTUAL_ID = 'virtual:third-party-notices';
const RESOLVED_ID = '\0' + VIRTUAL_ID;

/** Build failures from this plugin are prefixed so they are greppable in CI logs. */
function fail(message: string): never {
  throw new Error(`third-party-notices: ${message}`);
}

export interface LicenseRecord {
  readonly name: string;
  readonly version: string;
  readonly licenseId: string;
  readonly repository: string | undefined;
  readonly licenseText: string;
}

/**
 * Run `license-checker-rseidelsohn` over the production dependency graph of the
 * package at `rootDir`. `production: true` walks only the `dependencies` field
 * (transitively), so server-only and dev-only packages are excluded even though
 * the workspace hoists every package into a single flat `node_modules`.
 * `excludePrivatePackages` drops the first-party `was-web` / `@wallandshadow/*`
 * packages, which carry their own Apache-2.0 licence and need no attribution.
 */
function runLicenseChecker(rootDir: string): Promise<ModuleInfos> {
  return new Promise((resolvePromise, rejectPromise) => {
    init(
      {
        start: rootDir,
        production: true,
        excludePrivatePackages: true,
        // `licenseText` is only populated when `customFormat` is supplied — see
        // lib/index.js in the package. The standard fields are still included.
        customFormat: { licenseText: '' },
      },
      (err, packages) => {
        if (err) {
          rejectPromise(err);
        } else {
          resolvePromise(packages);
        }
      },
    );
  });
}

function normalizeLicenseId(licenses: string | string[] | undefined): string {
  if (licenses === undefined) {
    return 'UNKNOWN';
  }
  return Array.isArray(licenses) ? licenses.join(' / ') : licenses;
}

/**
 * Convert the raw license-checker output into validated records. A package with
 * no licence text, or one marked UNLICENSED (proprietary — no redistribution
 * right), is a genuine compliance gap and fails the build rather than shipping
 * an incomplete notices page.
 */
function toRecords(packages: ModuleInfos): LicenseRecord[] {
  const records: LicenseRecord[] = [];
  const missingText: string[] = [];
  const unlicensed: string[] = [];

  for (const [key, info] of Object.entries(packages)) {
    // license-checker keys entries as `name@version`; prefer the explicit
    // fields and fall back to splitting the key (scoped names contain '@', so
    // split on the last one).
    const atIndex = key.lastIndexOf('@');
    const name = info.name ?? key.slice(0, atIndex);
    const version = info.version ?? key.slice(atIndex + 1);
    const licenseId = normalizeLicenseId(info.licenses);
    const licenseText = (info.licenseText ?? '').trim();

    if (licenseId === 'UNLICENSED') {
      unlicensed.push(`${name}@${version}`);
    }
    if (licenseText === '') {
      missingText.push(`${name}@${version}`);
    }

    records.push({ name, version, licenseId, repository: info.repository, licenseText });
  }

  if (unlicensed.length > 0) {
    fail(`UNLICENSED (proprietary) packages cannot be redistributed: ${unlicensed.join(', ')}`);
  }
  if (missingText.length > 0) {
    fail(`no licence text found for: ${missingText.join(', ')}`);
  }
  return records;
}

/**
 * Every direct production dependency of `was-web` must appear in the scan. If
 * one is missing the installed tree is broken — fail loudly rather than ship a
 * notices page that silently omits a shipped library.
 */
function assertDirectDepsCovered(rootDir: string, records: readonly LicenseRecord[]): void {
  const pkgJson = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf-8')) as {
    dependencies?: Record<string, string>;
  };
  const direct = Object.keys(pkgJson.dependencies ?? {});
  const scanned = new Set(records.map((record) => record.name));
  const missing = direct.filter((name) => !scanned.has(name));
  if (missing.length > 0) {
    fail(`direct dependencies missing from the licence scan: ${missing.join(', ')}`);
  }
}

/** A code fence long enough to wrap `text` even if it contains backtick runs. */
function pickFence(text: string): string {
  let longestRun = 0;
  for (const run of text.match(/`+/g) ?? []) {
    longestRun = Math.max(longestRun, run.length);
  }
  return '`'.repeat(Math.max(3, longestRun + 1));
}

/** Normalised key for grouping packages that ship a byte-identical licence. */
function licenseKey(text: string): string {
  return text.replace(/\r\n/g, '\n').trim();
}

/**
 * Locale-independent string comparison (UTF-16 code-unit order). Used instead of
 * `localeCompare`, whose result depends on the build host's locale, so the
 * generated notices sort identically across machines and CI.
 */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Render the records as pure Markdown (no raw HTML — `rehype-raw` is not
 * enabled in About.tsx). Output is two parts: a flat list of every library,
 * then each distinct licence text once, with the libraries it covers. Packages
 * sharing identical licence text (e.g. the ~120 MIT libraries) are grouped so
 * the page stays readable. Sorting is deterministic for stable build output.
 */
export function renderNoticesMarkdown(records: readonly LicenseRecord[]): string {
  const sorted = [...records].sort((a, b) => {
    const byName = compareStrings(a.name.toLowerCase(), b.name.toLowerCase());
    return byName !== 0 ? byName : compareStrings(a.version, b.version);
  });

  const groups = new Map<string, { text: string; packages: LicenseRecord[] }>();
  for (const record of sorted) {
    const key = licenseKey(record.licenseText);
    const group = groups.get(key);
    if (group) {
      group.packages.push(record);
    } else {
      groups.set(key, { text: record.licenseText.replace(/\r\n/g, '\n').trimEnd(), packages: [record] });
    }
  }

  // Largest shared licences first; ties broken alphabetically for stability.
  const groupList = [...groups.values()].sort((a, b) => {
    const byCount = b.packages.length - a.packages.length;
    return byCount !== 0 ? byCount : compareStrings(a.packages[0].name, b.packages[0].name);
  });

  const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
  const lines: string[] = [
    `_Generated at build time from the production dependencies of \`was-web\` — ` +
      `${plural(sorted.length, 'package')}, ${plural(groupList.length, 'distinct licence')}._`,
    '',
    '### Libraries',
    '',
  ];

  for (const record of sorted) {
    // Wrap the URL in <> so a destination containing ')' or whitespace cannot
    // terminate the Markdown link early.
    const source =
      record.repository === undefined ? '' : ` — [source](<${record.repository}>)`;
    lines.push(`- **${record.name}** ${record.version} — ${record.licenseId}${source}`);
  }

  lines.push('', '### Licence texts', '');
  groupList.forEach((group, index) => {
    const applies = group.packages.map((pkg) => `\`${pkg.name}\``).join(', ');
    const fence = pickFence(group.text);
    lines.push(
      `#### Licence ${index + 1}`,
      '',
      `Applies to: ${applies}`,
      '',
      fence,
      group.text,
      fence,
      '',
    );
  });

  return lines.join('\n').trimEnd() + '\n';
}

async function generateNotices(rootDir: string): Promise<string> {
  const packages = await runLicenseChecker(rootDir);
  const records = toRecords(packages);
  if (records.length === 0) {
    fail('licence scan returned no packages — expected the production dependencies of was-web');
  }
  assertDirectDepsCovered(rootDir, records);
  return renderNoticesMarkdown(records);
}

/**
 * Vite plugin exposing `virtual:third-party-notices`, a Markdown string of the
 * licence notices for every npm package shipped to the browser. The scan is
 * memoised so it runs once per Vite process even if `load` is called repeatedly.
 */
export function thirdPartyNotices(): Plugin {
  let rootDir = process.cwd();
  let cache: Promise<string> | undefined;

  return {
    name: 'wallandshadow:third-party-notices',
    configResolved(config) {
      rootDir = config.root;
    },
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined;
    },
    load(id) {
      if (id !== RESOLVED_ID) {
        return undefined;
      }
      if (cache === undefined) {
        // Clear the cache if the scan fails so that, in `vite dev`, a fixed
        // cause (e.g. a reinstalled dependency) is retried on the next request
        // rather than the stale error persisting until the server restarts.
        cache = generateNotices(rootDir).catch((err: unknown) => {
          cache = undefined;
          throw err;
        });
      }
      return cache.then((markdown) => `export default ${JSON.stringify(markdown)};\n`);
    },
  };
}
