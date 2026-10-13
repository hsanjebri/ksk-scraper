#!/usr/bin/env node
/**
 * End-to-end check of the BUILT server, over real HTTP, against a real database.
 *
 * Plays both clients the production deployment has:
 *   - the dashboard: sign in, read /records and /records/status with the cookie
 *   - the plant collector: push the captured MAM list page and one detail page,
 *     HMAC-signed exactly like live-sync.ps1 does
 *
 * and checks the security boundaries in between (no session -> 401, unsigned,
 * wrongly-signed and replayed collector requests -> 401).
 *
 * Expects a running server (see .github/workflows/ci.yml) and:
 *   API_URL       default http://localhost:3000
 *   SYNC_SECRET   the server's collector key
 *   CI_USER       a DASHBOARD_USERS name
 *   CI_PASSWORD   that user's password
 *
 * Writes a results table to $GITHUB_STEP_SUMMARY when present. Exit code 1 if
 * any check fails.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';

const BASE = process.env.API_URL ?? 'http://localhost:3000';
const { SYNC_SECRET, CI_USER, CI_PASSWORD } = process.env;
if (!SYNC_SECRET || !CI_USER || !CI_PASSWORD) {
  console.error('SYNC_SECRET, CI_USER and CI_PASSWORD must be set.');
  process.exit(2);
}

const fixture = (name) =>
  readFileSync(
    new URL(`../../src/scraper/live/__fixtures__/${name}`, import.meta.url),
  );
const LIST_PAGE = fixture('real-list-MAM-head.html');
const DETAIL_PAGE = fixture('real-detail-MAM-2944-open.html');

// ---------------------------------------------------------------------------
// Tiny test harness
// ---------------------------------------------------------------------------

const results = [];

async function check(name, fn) {
  const started = performance.now();
  try {
    const detail = (await fn()) ?? '';
    results.push({ name, ok: true, detail, ms: performance.now() - started });
    console.log(`  ✔ ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (err) {
    results.push({
      name,
      ok: false,
      detail: err.message,
      ms: performance.now() - started,
    });
    console.log(`  ✘ ${name} — ${err.message}`);
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectStatus(response, status) {
  if (response.status !== status) {
    const body = (await response.text()).slice(0, 200);
    throw new Error(`expected HTTP ${status}, got ${response.status} ${body}`);
  }
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

let sessionCookie = null;

const dashboard = (path, init = {}) =>
  fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(sessionCookie ? { Cookie: sessionCookie } : {}),
      ...init.headers,
    },
  });

/** A collector request, signed the way live-sync.ps1 signs it. */
function signedRequest(path, payload, key = SYNC_SECRET) {
  const body = Buffer.from(JSON.stringify(payload));
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomBytes(16).toString('hex');
  const signature = createHmac('sha256', key)
    .update(`${timestamp}.${nonce}.`, 'utf8')
    .update(body)
    .digest('hex');

  // Returned as a function so the exact same bytes and headers can be resent.
  return () =>
    fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sync-Timestamp': timestamp,
        'X-Sync-Nonce': nonce,
        'X-Sync-Signature': signature,
      },
      body,
    });
}

const listPayload = () => ({
  model: 'MAM',
  agent: 'ci',
  listBase64: LIST_PAGE.toString('base64'),
});

// ---------------------------------------------------------------------------
// The suite
// ---------------------------------------------------------------------------

console.log(`Integration suite against ${BASE}\n`);

await check('Liveness probe answers', async () => {
  await expectStatus(await fetch(`${BASE}/`), 200);
});

await check('Data routes refuse anonymous callers', async () => {
  for (const path of ['/records', '/records/status']) {
    await expectStatus(await dashboard(path), 401);
  }
  return '/records, /records/status → 401';
});

await check('Wrong password is rejected', async () => {
  const response = await dashboard('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: CI_USER,
      password: `${CI_PASSWORD}-wrong`,
    }),
  });
  await expectStatus(response, 401);
});

await check('Sign-in issues a hardened session cookie', async () => {
  const response = await dashboard('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: CI_USER, password: CI_PASSWORD }),
  });
  await expectStatus(response, 204);

  const cookie = response.headers.getSetCookie()[0] ?? '';
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict']) {
    expect(
      cookie.toLowerCase().includes(flag.toLowerCase()),
      `cookie is missing ${flag}`,
    );
  }
  sessionCookie = cookie.split(';')[0];
  return 'HttpOnly · Secure · SameSite=Strict';
});

await check('Signed-in dashboard reads an empty relay', async () => {
  const response = await dashboard('/records/status');
  await expectStatus(response, 200);
  const status = await response.json();
  expect(status.mode === 'relay', `mode is ${status.mode}, expected relay`);
  expect(
    status.counts.total === 0,
    `database is not empty (${status.counts.total} records)`,
  );
});

await check('Unsigned collector push is rejected', async () => {
  const response = await fetch(`${BASE}/api/scraper/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(listPayload()),
  });
  await expectStatus(response, 401);
});

await check('Push signed with the wrong key is rejected', async () => {
  const send = signedRequest(
    '/api/scraper/ingest',
    listPayload(),
    'x'.repeat(64),
  );
  await expectStatus(await send(), 401);
});

const firstPush = signedRequest('/api/scraper/ingest', listPayload());

await check('Signed list page is parsed and stored', async () => {
  const response = await firstPush();
  await expectStatus(response, 201);
  const result = await response.json();
  expect(
    result.rowsOnPage === 12,
    `parsed ${result.rowsOnPage} rows, expected 12`,
  );
  expect(result.stored === 12, `stored ${result.stored} rows, expected 12`);
  expect(
    result.needDetails.includes('2944'),
    'record 2944 was not queued for its detail page',
  );
  return `${result.rowsOnPage} rows parsed, ${result.stored} stored, ${result.pending} queued`;
});

await check('Replayed request is rejected', async () => {
  await expectStatus(await firstPush(), 401);
  return 'same nonce → 401';
});

await check('Re-sending the page is idempotent', async () => {
  const response = await signedRequest('/api/scraper/ingest', listPayload())();
  await expectStatus(response, 201);
  const result = await response.json();
  expect(result.stored === 0, `stored ${result.stored} duplicate rows`);
  return '0 duplicates';
});

await check('Detail page completes the record', async () => {
  const response = await signedRequest('/api/scraper/ingest/details', {
    model: 'MAM',
    agent: 'ci',
    pages: [{ no: '2944', base64: DETAIL_PAGE.toString('base64') }],
  })();
  await expectStatus(response, 201);
  const result = await response.json();
  expect(
    result.applied === 1 && result.failed === 0,
    `applied ${result.applied}, failed ${result.failed}`,
  );
});

await check('Completed record reaches the dashboard API', async () => {
  const response = await dashboard('/records');
  await expectStatus(response, 200);
  const records = await response.json();
  expect(records.length === 1, `${records.length} visible records, expected 1`);
  const [record] = records;
  expect(
    record.no === '2944' && record.model === 'MAM',
    `unexpected record ${record.model} #${record.no}`,
  );
  return `MAM #${record.no} · car ${record.carId}`;
});

await check('Status reflects sync progress', async () => {
  const status = await (await dashboard('/records/status')).json();
  const { total, ready, pending } = status.counts;
  expect(
    total === 12 && ready === 1 && pending === 11,
    `total ${total}, ready ${ready}, pending ${pending}`,
  );
  expect(status.agent?.name === 'ci', 'collector contact was not recorded');
  return `${total} total · ${ready} ready · ${pending} pending`;
});

await check('Security headers are set', async () => {
  const response = await fetch(`${BASE}/`);
  const expected = {
    'content-security-policy': "default-src 'none'",
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'cache-control': 'no-store',
    'strict-transport-security': 'max-age=',
  };
  for (const [header, value] of Object.entries(expected)) {
    const actual = response.headers.get(header) ?? '';
    expect(actual.includes(value), `${header} is "${actual}"`);
  }
  expect(
    !response.headers.has('x-powered-by'),
    'X-Powered-By leaks the framework',
  );
  return 'CSP · nosniff · DENY · no-store · HSTS';
});

// Last: it spends this IP's sign-in budget for the rest of the minute.
await check('Sign-in is rate-limited', async () => {
  for (let attempt = 1; attempt <= 30; attempt++) {
    const response = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: `nobody-${attempt}`,
        password: 'not-the-password',
      }),
    });
    if (response.status === 429) {
      expect(response.headers.has('retry-after'), '429 without Retry-After');
      return `429 after ${attempt} attempts`;
    }
  }
  throw new Error('30 sign-in attempts in a row were never throttled');
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const failed = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed.`,
);

if (process.env.GITHUB_STEP_SUMMARY) {
  // Backslashes first, so the escapes added for pipes are not themselves escaped.
  const escape = (text) =>
    String(text)
      .replace(/\\/g, '\\\\')
      .replace(/\|/g, '\\|')
      .replace(/\r?\n/g, ' ');
  const rows = results
    .map(
      (r) =>
        `| ${r.ok ? '✅' : '❌'} | ${r.name} | ${escape(r.detail)} | ${Math.round(r.ms)} ms |`,
    )
    .join('\n');
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      `### 🐘 Integration suite — ${results.length - failed.length}/${results.length} passed`,
      '',
      'Built server + PostgreSQL 16, driven over HTTP as the dashboard and the HMAC-signed plant collector.',
      '',
      '| | Check | Detail | Time |',
      '|---|---|---|---:|',
      rows,
      '',
    ].join('\n'),
  );
}

process.exit(failed.length > 0 ? 1 : 0);
