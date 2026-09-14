#!/usr/bin/env node
/**
 * Captures the REAL rework site's HTML so the Cheerio selectors can be written
 * against actual markup instead of guesses.
 *
 * ⚠️ Must be run from a machine INSIDE the SEBN network. The host
 * `rework.jenapp0001.sebn.com` only resolves on internal DNS — from outside it
 * is NXDOMAIN, which is why the parser in src/scraper/live/live-http.source.ts
 * is currently written blind.
 *
 * Usage (from the project root, on-network):
 *
 *   node capture-real-pages.js
 *   node capture-real-pages.js --model MAM
 *   node capture-real-pages.js --base http://rework.jenapp0001.sebn.com
 *
 * Writes into ./captured/:
 *   list-<MODEL>.html     the POST Szczegol.php?AK=1 results page
 *   detail-<NO>.html      the first result's detail page
 *   summary.txt           table/row/column counts found in each
 *
 * Then send me those files and I'll finish the real parser.
 */
const fs = require('node:fs');
const path = require('node:path');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const BASE = arg('base', 'http://rework.jenapp0001.sebn.com').replace(/\/+$/, '');
const MODEL = arg('model', 'MAM');
const OUT = path.join(__dirname, 'captured');

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const summary = [`base: ${BASE}`, `model: ${MODEL}`, `captured: ${new Date().toISOString()}`, ''];

  // ---- 1. the search results (list) page ----
  const listUrl = `${BASE}/Szczegol.php?AK=1`;
  console.log(`POST ${listUrl}  (model=${MODEL})`);

  const listRes = await fetch(listUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ model: MODEL }).toString(),
  });
  const listHtml = await listRes.text();

  const listFile = path.join(OUT, `list-${MODEL}.html`);
  fs.writeFileSync(listFile, listHtml, 'utf8');
  console.log(`  -> ${listFile}  (${listRes.status}, ${listHtml.length} bytes)`);

  summary.push(`LIST PAGE  status=${listRes.status}  bytes=${listHtml.length}`);
  summary.push(`  <table> count: ${(listHtml.match(/<table/gi) || []).length}`);
  summary.push(`  <tr>    count: ${(listHtml.match(/<tr/gi) || []).length}`);

  // Pull the first detail link so we capture a real, existing record.
  const linkMatch = listHtml.match(/Szczegol\.php\?numer=([^&"'\s]+)&(?:amp;)?model=([^"'\s>]+)/i);
  if (!linkMatch) {
    summary.push('  !! no Szczegol.php?numer=... link found — check the markup by hand');
    fs.writeFileSync(path.join(OUT, 'summary.txt'), summary.join('\n'), 'utf8');
    console.log('\nNo detail link found in the list page. Send list-*.html anyway.');
    return;
  }

  // ---- 2. one detail page ----
  const [, numer, model] = linkMatch;
  const detailUrl = `${BASE}/Szczegol.php?numer=${numer}&model=${model}`;
  console.log(`GET  ${detailUrl}`);

  const detailRes = await fetch(detailUrl);
  const detailHtml = await detailRes.text();

  const detailFile = path.join(OUT, `detail-${numer}.html`);
  fs.writeFileSync(detailFile, detailHtml, 'utf8');
  console.log(`  -> ${detailFile}  (${detailRes.status}, ${detailHtml.length} bytes)`);

  summary.push('');
  summary.push(`DETAIL PAGE  numer=${numer} model=${model}  status=${detailRes.status}  bytes=${detailHtml.length}`);
  summary.push(`  <table> count: ${(detailHtml.match(/<table/gi) || []).length}`);
  summary.push(`  <tr>    count: ${(detailHtml.match(/<tr/gi) || []).length}`);

  // Field labels drive the detail parser — list what's actually on the page.
  const cells = [...detailHtml.matchAll(/<t[dh][^>]*>([^<]{2,40})<\/t[dh]>/gi)]
    .map((m) => m[1].replace(/&nbsp;/g, ' ').trim())
    .filter((t) => /[A-Za-zÀ-ÿ]/.test(t));
  summary.push('  first 40 cell texts (these are the labels to match on):');
  for (const text of cells.slice(0, 40)) summary.push(`    | ${text}`);

  fs.writeFileSync(path.join(OUT, 'summary.txt'), summary.join('\n'), 'utf8');
  console.log(`\nDone. Send the whole ./captured/ folder.`);
}

main().catch((err) => {
  // Node's fetch reports a bare "fetch failed" and hides the real reason
  // (ENOTFOUND, ECONNREFUSED, timeout) one level down in `cause`.
  const cause = err.cause ? `${err.cause.code ?? ''} ${err.cause.message ?? ''}`.trim() : '';
  console.error('\nCapture failed:', err.message + (cause ? ` — ${cause}` : ''));

  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(cause || err.message)) {
    console.error('\nThat hostname did not resolve — you are almost certainly not on the');
    console.error('SEBN network. Run this from a plant machine or over the company VPN.');
  }
  process.exit(1);
});
