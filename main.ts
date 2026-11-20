// Token Radar: a make.fun token-radar-01 entry, Node 22, standard library only.
//
// The program takes the sealed snapshot (DefiLlama's protocol index as of
// 2026-11-14), scores every pre-token protocol with the radar-2 model in
// lib/model.ts, and writes the entry's outputs:
//
//   board.json    the ranked board: 200 rows, watchlist first by coverage
//   data.js       the same board, compact, for the dashboard to read
//   dashboard/    the static HUD page (index.html, app.css, app.js)
//   screenshots/  the three dashboard views the judge reads
//   dossier.json  the judge's summary, built by vendor/makefun-board.ts
//
// Run it from the repository root:
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
//
// Inside the grader the snapshot is mounted at /input and the outputs go
// to /output; MAKEFUN_OUTPUT_DIR and --input/--output stand in for those
// paths anywhere else. No network is used at any point.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const REPO_ROOT = fileURLToPath(new URL('.', import.meta.url));

/** The gate's own caps, mirroring reference/gate.json: the text cap shapes the dossier, the rest refuse. */
const DOSSIER_TEXT_CAP = 65_536;
const SCREENSHOT_LIMIT = { max: 4, max_bytes: 524_288 };
const DASHBOARD_LIMIT = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Read `--name value` or `--name=value` from the argument list, else the fallback. */
function option(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const glued = process.argv.find((a) => a.startsWith(`--${name}=`));
  return glued === undefined ? fallback : glued.slice(name.length + 3);
}

/** Fail with a message on stderr and a non-zero exit. */
function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

/** The snapshot file: --input <snapshot.json|directory>, defaulting to /input/snapshot.json. */
function snapshotPath(): string {
  const given = option('input', '/input');
  return given.endsWith('.json') ? given : join(given, 'snapshot.json');
}

/** Copy a directory's regular files into `dest`, skipping dotfiles, and return the names copied. */
function copyDir(from: string, dest: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(dest, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const src = join(from, name);
    if (!statSync(src).isFile()) continue;
    copyFileSync(src, join(dest, name));
    names.push(name);
  }
  return names;
}

const inFile = snapshotPath();
if (!existsSync(inFile)) {
  fail(`no snapshot at ${inFile}: pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const outDir = option('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const problem = boardIssue(board, snapshot);
if (problem !== null) fail(`the model wrote a board the gate refuses: ${problem}`);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ` +
  `${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n`,
);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

const pageFiles = copyDir(join(REPO_ROOT, 'dashboard'), join(outDir, 'dashboard'));
const shotFiles = copyDir(join(REPO_ROOT, 'screenshots'), join(outDir, 'screenshots'));
if (shotFiles.length < 3) {
  fail(`screenshots/ holds ${shotFiles.length} image${shotFiles.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
}
for (const name of shotFiles) {
  if (!IMAGE_NAME.test(name)) {
    fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, { text_max_bytes: DOSSIER_TEXT_CAP, screenshots: SCREENSHOT_LIMIT, dashboard: DASHBOARD_LIMIT }),
);

process.stdout.write(
  `token radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ` +
  `${join(outDir, 'dashboard')} (${pageFiles.length} files), ` +
  `${join(outDir, 'screenshots')} (${shotFiles.length} images) and ${join(outDir, 'dossier.json')}\n`,
);
