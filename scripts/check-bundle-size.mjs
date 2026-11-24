#!/usr/bin/env node
/**
 * Bundle budget gate for the offline PWA.
 *
 * Walks dist/ recursively, computes the gzip size of every shipped file and
 * fails when the sum exceeds 5 MiB. Source maps are ignored here (and are not
 * emitted by the build) because they are not part of the shipped application.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

const DIST_DIR = path.resolve(process.cwd(), 'dist');
const BUDGET_BYTES = 5 * 1024 * 1024; // 5 MiB gzipped

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function gzipSize(file) {
  return gzipSync(readFileSync(file), { level: 9 }).length;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function main() {
  let files;
  try {
    files = walk(DIST_DIR).filter((file) => !file.endsWith('.map'));
  } catch (error) {
    console.error(`Bundle check failed: cannot read ${DIST_DIR} (${error.message})`);
    process.exit(1);
  }

  const rows = files
    .map((file) => ({
      name: path.relative(DIST_DIR, file).split(path.sep).join('/'),
      raw: statSync(file).size,
      gzip: gzipSize(file),
    }))
    .sort((a, b) => b.gzip - a.gzip);

  const totalGzip = rows.reduce((sum, row) => sum + row.gzip, 0);
  const totalRaw = rows.reduce((sum, row) => sum + row.raw, 0);

  const nameWidth = Math.max('FILE'.length, ...rows.map((row) => row.name.length));
  console.log(`Bundle size report (gzip level 9, source maps excluded)\n`);
  console.log(`${'FILE'.padEnd(nameWidth)}  ${'RAW'.padStart(10)}  ${'GZIP'.padStart(10)}`);
  console.log(`${'-'.repeat(nameWidth)}  ${'-'.repeat(10)}  ${'-'.repeat(10)}`);
  for (const row of rows) {
    console.log(`${row.name.padEnd(nameWidth)}  ${formatBytes(row.raw).padStart(10)}  ${formatBytes(row.gzip).padStart(10)}`);
  }
  console.log(`${'-'.repeat(nameWidth)}  ${'-'.repeat(10)}  ${'-'.repeat(10)}`);
  console.log(`TOTAL (${rows.length} files)  ${formatBytes(totalRaw).padStart(10)}  ${formatBytes(totalGzip).padStart(10)}`);
  console.log(`Budget: ${formatBytes(BUDGET_BYTES)} gzipped`);

  if (totalGzip > BUDGET_BYTES) {
    console.error(`FAIL: total gzipped bundle exceeds the ${formatBytes(BUDGET_BYTES)} budget.`);
    process.exit(1);
  }
  console.log('PASS: bundle is within budget.');
}

main();
