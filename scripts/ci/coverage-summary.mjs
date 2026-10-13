#!/usr/bin/env node
/**
 * Turns Jest's json-summary coverage into a table on the workflow run page.
 *
 *   node scripts/ci/coverage-summary.mjs [coverage/coverage-summary.json]
 *
 * Report only: coverage is shown, not enforced. A threshold belongs in the
 * Jest config (coverageThreshold) once there is a baseline worth defending.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const file = process.argv[2] ?? 'coverage/coverage-summary.json';
if (!existsSync(file)) {
  console.log(`No coverage summary at ${file} — skipping.`);
  process.exit(0);
}

const { total } = JSON.parse(readFileSync(file, 'utf8'));

const bar = (pct) => {
  const filled = Math.round(pct / 10);
  return '🟩'.repeat(filled) + '⬜'.repeat(10 - filled);
};

const rows = ['lines', 'statements', 'functions', 'branches'].map((metric) => {
  const { pct, covered, total: count } = total[metric];
  return `| ${metric[0].toUpperCase()}${metric.slice(1)} | ${bar(pct)} | **${pct.toFixed(1)}%** | ${covered} / ${count} |`;
});

const markdown = [
  '### 🧪 Unit test coverage',
  '',
  '| Metric | | Coverage | Covered |',
  '|---|---|---:|---:|',
  ...rows,
  '',
  '<sub>Full HTML report: the <code>coverage-report</code> artifact of this run.</sub>',
  '',
].join('\n');

console.log(markdown);
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
