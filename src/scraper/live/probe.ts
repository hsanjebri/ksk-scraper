import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { KSK_MODELS, KskModel, projectFor } from '../constants';
import { LiveHttpSource } from './live-http.source';

/**
 * One-shot connectivity + parsing probe for the real rework site.
 *
 * Run this ON the SEBN network BEFORE enabling the live scraper:
 *
 *     npm run scrape:probe
 *
 * It performs exactly one search per model and one detail fetch, prints what
 * it parsed, and WRITES NOTHING to the database. The point is to find out
 * whether the selectors are right while a mistake is still free — as opposed
 * to letting the scheduler quietly fill the database with wrong data.
 *
 * Exit code is 0 only if every stage parsed something, so it can be used as a
 * go/no-go gate.
 */

// LiveHttpSource only ever calls config.get(), so a thin env-backed stand-in
// is enough and avoids booting the whole Nest container for a probe.
const config = {
  get<T>(key: string, fallback?: T): T | string | undefined {
    return process.env[key] ?? fallback;
  },
} as unknown as ConfigService;

function heading(text: string): void {
  console.log(`\n${'='.repeat(64)}\n${text}\n${'='.repeat(64)}`);
}

async function main(): Promise<number> {
  const baseUrl = process.env.SITE_BASE_URL;
  heading('REWORK SCRAPER PROBE');
  console.log(`SITE_BASE_URL : ${baseUrl ?? '(not set)'}`);
  console.log(`models        : ${KSK_MODELS.map((m) => `${m} -> ${projectFor(m)}`).join(', ')}`);

  if (!baseUrl) {
    console.error(
      '\nSITE_BASE_URL is not set. Add it to .env, e.g.\n' +
        '  SITE_BASE_URL=http://rework.jenapp0001.sebn.com\n',
    );
    return 2;
  }

  const source = new LiveHttpSource(config);
  let firstModel: KskModel | null = null;
  let firstNo: string | null = null;
  let ok = true;

  // ---- stage 1: the list page, per model ----
  for (const model of KSK_MODELS) {
    heading(`LIST  ${model}  (${projectFor(model)})`);
    try {
      const rows = await source.getListPage(model);
      if (rows.length === 0) {
        ok = false;
        console.log('0 rows parsed  <-- FAIL. Raw HTML saved under debug/.');
        console.log('Send that file and the selectors can be corrected against it.');
        continue;
      }

      console.log(`${rows.length} rows parsed  <-- OK`);
      console.log('\nnewest 3:');
      for (const row of rows.slice(0, 3)) {
        console.log(
          `  no=${row.no}  car=${row.carId || '(none)'}  zsb=${row.zsb}  ` +
            `registered=${row.registered}  err=${row.errorCode}  color=${row.color}`,
        );
      }

      // Sanity-check the date actually parsed rather than silently defaulting.
      const unparsed = rows.filter((r) => {
        const t = new Date(r.registered).getTime();
        return Number.isNaN(t) || Math.abs(Date.now() - t) < 60_000;
      }).length;
      if (unparsed > 0) {
        console.log(
          `\n  WARNING: ${unparsed} row(s) have a registered date that looks like "now" —\n` +
            '  that is the fallback used when the timestamp could not be parsed.\n' +
            '  Check the site date format against parseSiteDate().',
        );
      }

      if (!firstModel) {
        firstModel = model;
        firstNo = rows[0].no;
      }
    } catch (err) {
      ok = false;
      console.log(`REQUEST FAILED: ${err instanceof Error ? err.message : err}`);
      if (err instanceof Error && /ENOTFOUND|EAI_AGAIN/i.test(err.message)) {
        console.log('\nThe hostname did not resolve — you are not on the SEBN network.');
      }
    }
  }

  // ---- stage 2: one detail page ----
  if (firstModel && firstNo) {
    heading(`DETAIL  ${firstModel} #${firstNo}`);
    try {
      const detail = await source.getDetailPage(firstNo, firstModel);
      const populated = Object.entries(detail).filter(
        ([, v]) => v !== null && v !== '' && !(Array.isArray(v) && v.length === 0),
      );

      if (populated.length <= 3) {
        ok = false;
        console.log('Almost nothing parsed  <-- FAIL. Raw HTML saved under debug/.');
        console.log('This is the known-unverified parser — that dump is exactly what is needed.');
      } else {
        console.log('parsed fields:');
        for (const [key, value] of populated) {
          if (key === 'errorCodes') continue;
          console.log(`  ${key.padEnd(20)} ${String(value)}`);
        }
        console.log(`  errorCodes           ${detail.errorCodes.length} entry(ies)`);
        console.log(
          detail.reworked
            ? '\n  status -> Terminé (reworked timestamp present)'
            : '\n  status -> En cours (no reworked timestamp)',
        );
      }
    } catch (err) {
      ok = false;
      console.log(`REQUEST FAILED: ${err instanceof Error ? err.message : err}`);
    }
  }

  heading(ok ? 'RESULT: PASS — safe to set SCRAPER_MODE=live' : 'RESULT: FAIL — do not enable live mode yet');
  return ok ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('Probe crashed:', err);
    process.exit(3);
  });
