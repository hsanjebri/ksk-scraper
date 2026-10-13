#!/usr/bin/env node
/**
 * Audits production dependencies of the API and the dashboard and reports the
 * result on the workflow run page, with an annotation per vulnerable package.
 *
 *   AUDIT_FAIL_ON=none|critical|high   (default: none — report only)
 *
 * Starts as report-only because known advisories exist today; raise the bar
 * once Dependabot's upgrade PRs have landed.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const PROJECTS = [
  { name: 'API', dir: '.' },
  { name: 'Dashboard', dir: 'dashboard' },
];
const LEVELS = ['critical', 'high', 'moderate', 'low'];
const failOn = (process.env.AUDIT_FAIL_ON ?? 'none').toLowerCase();
const blocking =
  failOn === 'none' ? [] : LEVELS.slice(0, LEVELS.indexOf(failOn) + 1);

function audit(dir) {
  let output;
  try {
    output = execFileSync('npm', ['audit', '--omit=dev', '--json'], {
      cwd: dir,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
  } catch (err) {
    // npm audit exits non-zero whenever it finds something; the JSON is still on stdout.
    output = err.stdout;
  }
  return JSON.parse(output);
}

const rows = [];
let shouldFail = false;

for (const project of PROJECTS) {
  const report = audit(project.dir);
  const counts = report.metadata.vulnerabilities;
  rows.push(
    `| ${project.name} | ${LEVELS.map((level) => counts[level] || '·').join(' | ')} |`,
  );

  for (const [pkg, vuln] of Object.entries(report.vulnerabilities ?? {})) {
    if (vuln.severity !== 'critical' && vuln.severity !== 'high') continue;
    const fix = vuln.fixAvailable ? 'fix available' : 'no fix yet';
    const kind = blocking.includes(vuln.severity) ? 'error' : 'warning';
    console.log(
      `::${kind} title=${project.name}: ${vuln.severity} in ${pkg}::${pkg} (${vuln.range}) — ${fix}`,
    );
  }
  if (blocking.some((level) => counts[level] > 0)) shouldFail = true;
}

const markdown = [
  '### 🛡️ Production dependency audit',
  '',
  '| Project | Critical | High | Moderate | Low |',
  '|---|---:|---:|---:|---:|',
  ...rows,
  '',
  `<sub>Policy: ${blocking.length ? `fail on ${failOn} or worse` : 'report only'} · \`npm audit --omit=dev\`</sub>`,
  '',
].join('\n');

console.log(markdown);
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
process.exit(shouldFail ? 1 : 0);
