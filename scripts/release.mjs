#!/usr/bin/env node
/**
 * Release helper for CPNS BMKG SKB Prep.
 *
 * Usage:
 *   npm run release -- <x.y.z> [--push] [--dry-run]
 *
 * The release is tagged from a clean `main` worktree. `--dry-run` still runs
 * every quality gate but skips the git safety gates and all mutating steps
 * (version bump, release commit, tag, push), which makes it safe to use in any
 * checkout for verification.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

function run(command, args) {
  console.log(`\n$ ${[command, ...args].join(' ')}`);
  execFileSync(command, args, { cwd: ROOT, stdio: 'inherit' });
}

function gitOutput(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || '',
  };
}

function compareVersions(a, b) {
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1; // stable > pre-release
  if (!b.prerelease) return -1;
  const aParts = a.prerelease.split('.');
  const bParts = b.prerelease.split('.');
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i += 1) {
    const x = aParts[i];
    const y = bParts[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) return Number(x) > Number(y) ? 1 : -1;
    if (xNum) return -1;
    if (yNum) return 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function changelogSection(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const heading = new RegExp(`^## \\[${escapeRegExp(version)}\\](?:\\s|$)`, 'm');
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) fail(`CHANGELOG.md has no "## [${version}]" heading`);
  const end = lines.findIndex((line, index) => index > start && /^## \[/.test(line));
  const section = lines
    .slice(start + 1, end === -1 ? lines.length : end)
    .join('\n')
    .trim();
  if (!section) fail(`CHANGELOG.md section "## [${version}]" is empty`);
  return section;
}

function tagMessage(version, section) {
  const summary = section.split('\n').slice(0, 25).join('\n').trim();
  const truncated = section.split('\n').length > 25;
  return [
    `Release v${version}`,
    '',
    `## [${version}]`,
    '',
    summary,
    truncated ? '\n...(see CHANGELOG.md for the full release notes).' : '',
    '',
    'Perubahan lengkap: CHANGELOG.md',
  ]
    .filter(Boolean)
    .join('\n');
}

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith('--')));
for (const flag of flags) {
  if (flag !== '--push' && flag !== '--dry-run') fail(`unknown flag: ${flag}`);
}
const version = args.find((arg) => !arg.startsWith('--'));
if (!version) fail('usage: npm run release -- <x.y.z> [--push] [--dry-run]');

const dryRun = flags.has('--dry-run');
const push = flags.has('--push');
if (dryRun && push) fail('--dry-run and --push are mutually exclusive');

const parsed = parseVersion(version);
if (!parsed) fail(`invalid semantic version: ${version} (expected x.y.z)`);

const tag = `v${version}`;
const pushCommand = 'git push origin main --follow-tags';

if (dryRun) {
  console.log('release: dry-run — all checks run, git safety gates and mutating steps are skipped.');
} else {
  const dirty = gitOutput(['status', '--porcelain']);
  if (dirty) {
    console.error(dirty);
    fail('worktree is dirty; commit or stash changes before releasing');
  }
  const branch = gitOutput(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== 'main') fail(`releases must be cut from main (current branch: ${branch})`);
}

if (gitOutput(['tag', '-l', tag])) fail(`tag ${tag} already exists`);

const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const current = parseVersion(pkg.version);
if (!current) fail(`package.json has an invalid version: ${pkg.version}`);
const order = compareVersions(parsed, current);
if (order < 0) fail(`${version} is older than package.json version ${pkg.version}`);

// v1.0.0 is the inaugural release: the package already carries that version,
// so tagging is allowed when the tag itself does not exist yet.
const equalVersionAllowed = version === '1.0.0' && order === 0;
if (order === 0 && !equalVersionAllowed) {
  fail(`${version} equals package.json version ${pkg.version}; nothing to release`);
}
const needsVersionBump = order > 0;

const section = changelogSection(readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8'), version);
const message = tagMessage(version, section);

if (dryRun) {
  console.log(`\nrelease: dry-run — would${needsVersionBump ? ` bump ${pkg.version} -> ${version}` : ' keep package version'} and create annotated tag ${tag}.`);
  console.log(`release: dry-run — tag message:\n${message}`);
} else {
  if (needsVersionBump) {
    run(npmCmd, ['version', version, '--no-git-tag-version']);
  } else {
    console.log(`\nrelease: package version already ${version}; skipping npm version.`);
  }
  const changed = gitOutput(['status', '--porcelain', '--', 'package.json', 'package-lock.json', 'CHANGELOG.md']);
  if (changed) {
    run('git', ['add', 'package.json', 'package-lock.json', 'CHANGELOG.md']);
    run('git', ['commit', '-m', `chore(release): ${tag}`]);
  }
}

for (const script of ['lint', 'test:run', 'build', 'check:size']) {
  run(npmCmd, ['run', script]);
}

if (dryRun) {
  console.log(`\nrelease: dry-run — would create annotated tag ${tag}; nothing was pushed.`);
  console.log(`release: dry-run — next step after a real release: ${pushCommand}`);
} else {
  run('git', ['tag', '-a', tag, '-m', message]);
  if (push) {
    run('git', ['push', 'origin', 'main', '--follow-tags']);
  } else {
    console.log(`\nrelease: ${tag} created locally. To publish it, run: ${pushCommand}`);
  }
}
