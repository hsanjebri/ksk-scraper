#!/usr/bin/env node
/**
 * Replay server for the rework site.
 *
 * Serves pages captured from rework.jenapp0001.sebn.com (by capture.ps1) so
 * the REAL backend can run in SCRAPER_MODE=live on a machine that is not on
 * the SEBN network. Same HTTP code, same parsers, same scheduler, same
 * database — only the hostname differs.
 *
 *   node tools/replay-site.cjs                    # serves ./captured/captured on :8099
 *   CAPTURE_DIR=path PORT=8099 CHARSET=latin1 node tools/replay-site.cjs
 *
 * then start the backend with
 *   SCRAPER_MODE=live SITE_BASE_URL=http://127.0.0.1:8099 npm run start:prod
 *
 * What it serves:
 *   GET  /main.php                       sets a session cookie
 *   POST /Szczegol.php?AK=1              the captured list page for the posted model
 *                                        (rejects requests without the cookie or the
 *                                        seven form fields — like a strict server)
 *   GET  /Szczegol.php?numer=N&model=M   the captured detail page when one exists;
 *                                        otherwise one SYNTHESISED from the real page
 *                                        structure, carrying N's CarID/ZSB/Registered
 *                                        from the list. Synthesised pages send the
 *                                        header X-Replay-Synthesized: 1.
 *
 * Test controls (the three controls below mirror the real three-stage flow:
 * Rework In -> Rework Out -> Quality Control):
 *   GET /__replay/add?model=MCM          a new record appears at the top of the list
 *   GET /__replay/rework?model=MAM&no=N  N is repaired, quality control still pending
 *   GET /__replay/qc?model=MAM&no=N      quality control releases N
 *   GET /__replay/close?model=MAM&no=N   both at once
 *   GET /__replay/addcode?model=M&no=N&code=140
 *                                        an extra error code is added to N, as an
 *                                        operator can during the repair (manual §3.3)
 *   GET /__replay/log                    request counts and validation results
 *
 * CHARSET=latin1 (default) sends Latin-1 bytes with NO charset header — the
 * hardest case for the decoder, and a common one for legacy PHP. CHARSET=utf8
 * sends UTF-8 with charset=UTF-8.
 */
const http = require('http')
const fs = require('fs')
const path = require('path')
const { URL } = require('url')

const PORT = Number(process.env.PORT || 8099)
const CAPTURE_DIR = path.resolve(process.env.CAPTURE_DIR || path.join(__dirname, '..', 'captured', 'captured'))
const CHARSET = (process.env.CHARSET || 'latin1').toLowerCase()
const DELAY_MS = Number(process.env.DELAY_MS || 0)
const MODELS = ['MAM', 'MCM']
const REQUIRED_FIELDS = ['numer', 'model', 'kenn', 'rej1', 'rej2', 'komentar', 'kolor']

const read = (file) => fs.readFileSync(path.join(CAPTURE_DIR, file), 'utf8').replace(/^﻿/, '')

// ---------------------------------------------------------------- captures
const lists = {}
const details = {} // `${model}:${no}` -> html
const templates = {} // model -> any real detail page for that model

for (const model of MODELS) {
  lists[model] = read(`list-${model}.html`)
}
for (const file of fs.readdirSync(CAPTURE_DIR)) {
  const m = /^detail-(MAM|MCM)-(\d+)\.html$/i.exec(file)
  if (!m) continue
  const html = read(file)
  details[`${m[1].toUpperCase()}:${m[2]}`] = html
  templates[m[1].toUpperCase()] = templates[m[1].toUpperCase()] || html
}
// Either model's page works as a structural template for the other.
for (const model of MODELS) templates[model] = templates[model] || Object.values(details)[0]

// Index list rows: No. -> { carId, zsb, registered, errorCode, comment }
const ROW = /<tr\s+bgcolor="?#DEDEDF"?>\s*<td>([^<]*)<\/td>\s*<td>[^<]*<\/td>\s*(?:<td>)?([\s\S]*?)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>/gi
const index = {}
const maxNo = {}
function indexRows(model, html) {
  index[model] = index[model] || new Map()
  for (const m of html.matchAll(ROW)) {
    const no = m[1].trim()
    index[model].set(no, {
      carId: m[2].replace(/<[^>]*>/g, '').trim(),
      zsb: m[3].trim(),
      registered: m[4].trim(),
      errorCode: m[5].trim(),
      comment: m[6].trim(),
    })
    maxNo[model] = Math.max(maxNo[model] || 0, Number(no) || 0)
  }
}
for (const model of MODELS) indexRows(model, lists[model])

// ---------------------------------------------------------------- state
const injected = { MAM: [], MCM: [] } // raw <tr> strings, newest first
const reworkedAt = new Map() // `${model}:${no}` -> 'YYYY-MM-DD HH:mm:ss'
const qcAt = new Map() // `${model}:${no}` -> 'YYYY-MM-DD HH:mm:ss'
const extraCodes = new Map() // `${model}:${no}` -> [<tr> strings]
const sessions = new Set()
let sessionCounter = 0
const log = {
  mainPhp: 0,
  listPosts: 0,
  listRejected: 0,
  lastListPost: null,
  detailGets: 0,
  detailReal: 0,
  detailSynthesized: 0,
  detailNotFound: 0,
}

const pad = (n) => String(n).padStart(2, '0')
const siteDate = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
const parseSite = (s) => {
  const m = /(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(s || '')
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null
}

// Row fragments copied from the real detail page markup.
const REWORKED_OPEN =
  '<tr bgColor=#CECECE><TD><Font color=#225077>reworked</Font></td><TD></td><TD colspan=1></td><td>shift: </td><td colspan="2">time (min): </td></tr>'
const reworkedClosed = (at, minutes) =>
  `<tr bgColor=#CECECE><TD><Font color=#225077>reworked</Font></td><TD>143</td><TD colspan=1>${at}</td><td>shift: A</td><td colspan="2">time (min): ${minutes}</td></tr>`
const QC_EMPTY =
  '<tr bgColor=#CECECE><TD><Font color=#225077>quality control</Font></td><TD vAlign=top></td><TD colspan=2 vAlign=top></td><td colspan="2"></td></tr>'
const qcDone = (at) =>
  `<tr bgColor=#CECECE><TD><Font color=#225077>quality control</Font></td><TD vAlign=top>4821</td><TD colspan=2 vAlign=top>${at}</td><td colspan="2"></td></tr>`

const REWORKED_ROW = /<tr bgColor=#CECECE><TD><Font color=#225077>reworked<\/Font><\/td>[\s\S]*?<\/tr>/i
const QC_ROW = /<tr bgColor=#CECECE><TD><Font color=#225077>quality control<\/Font><\/td>[\s\S]*?<\/tr>/i

/** Deterministic pseudo-random in [0,1) per record, so replays are repeatable. */
const hash01 = (key) => {
  let h = 2166136261
  for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return ((h >>> 0) % 10000) / 10000
}

function withState(html, model, no, registered) {
  const key = `${model}:${no}`
  const rework = reworkedAt.get(key)
  const qc = qcAt.get(key)
  const extra = extraCodes.get(key)

  if (rework) {
    const reg = parseSite(registered) || new Date()
    const minutes = Math.max(0, Math.round((parseSite(rework) - reg) / 60000))
    html = html.replace(REWORKED_ROW, reworkedClosed(rework, minutes))
  }
  if (qc) html = html.replace(QC_ROW, qcDone(qc))
  if (extra) {
    // Appended to the error codes list, which is the page's last table.
    const at = html.lastIndexOf('</table>')
    if (at >= 0) html = html.slice(0, at) + extra.join('') + html.slice(at)
  }
  return html
}

function synthesizeDetail(model, no) {
  const row = index[model] && index[model].get(no)
  if (!row) return null
  const reg = parseSite(row.registered)

  let html = templates[model]
    .replace(/(rework ID<\/Font><\/td><TD align=center><B>)\d+(<\/B>)/i, `$1${no}$2`)
    .replace(/(model<\/Font><\/td><TD align=center><B>)\w+(<\/B>)/i, `$1${model}$2`)
    .replace(/(CarID \/ Unique No\.<\/Font><\/td><TD bgcolor=#F0D0A0>)[^<]*/i, `$1${row.carId}`)
    .replace(/(ZSB \/ PartName <\/Font><\/td><TD bgcolor=#F0D0A0>)[^<]*/i, `$1${row.zsb}`)
    .replace(/(registered<\/Font><\/td><TD>\d*<\/td><TD colspan=1>)[^<]*/i, `$1${row.registered}`)
    // The record's own error code and comment — otherwise every synthesised
    // page would carry the template record's, and the scraper would (rightly)
    // take the template's longer full-text comment over the list's.
    .replace(/(error code <br><\/Font>)[^<]*/i, `$1${row.errorCode}`)
    .replace(/(comment:<\/Font><\/td><TD colspan="5">)[^<]*/i, `$1${row.comment}`)
    .replace(
      /(Error codes list<\/h4>[\s\S]*?<tr bgcolor=#D8D8D8><td>)[^<]*(<\/td>[\s\S]*?<td>)[^<]*(<\/td><\/tr>)/i,
      `$1${row.errorCode}$2${row.comment}$3`,
    )

  // Anything older than a day is closed; a day or younger is open ~40% of the time.
  const ageHours = reg ? (Date.now() - reg.getTime()) / 3600000 : 999
  const open = ageHours < 24 && hash01(`${model}:${no}`) < 0.4
  if (open || !reg) {
    html = html.replace(REWORKED_ROW, REWORKED_OPEN).replace(QC_ROW, QC_EMPTY)
  } else {
    const minutes = 5 + Math.floor(hash01(`m:${model}:${no}`) * 235)
    const rw = new Date(reg.getTime() + minutes * 60000)
    html = html
      .replace(REWORKED_ROW, reworkedClosed(siteDate(rw), minutes))
      .replace(QC_ROW, qcDone(siteDate(new Date(rw.getTime() + 30000))))
  }
  return html
}

function listPage(model) {
  if (injected[model].length === 0) return lists[model]
  // New rows go straight under the header row — the top of the page is newest.
  return lists[model].replace(/(<tr bgcolor=#DDCACA>[\s\S]*?<\/tr>)/i, `$1${injected[model].join('')}`)
}

// ---------------------------------------------------------------- http
function send(res, status, body, headers = {}) {
  const buf = CHARSET === 'utf8' ? Buffer.from(body, 'utf8') : Buffer.from(body, 'latin1')
  res.writeHead(status, {
    'Content-Type': CHARSET === 'utf8' ? 'text/html; charset=UTF-8' : 'text/html',
    'Content-Length': buf.length,
    ...headers,
  })
  res.end(buf)
}

function json(res, value) {
  const body = JSON.stringify(value, null, 2)
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(body)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    setTimeout(() => {
      try {
        route(req, res, url, Buffer.concat(chunks).toString('utf8'))
      } catch (err) {
        send(res, 500, `<html><body>replay error: ${err.message}</body></html>`)
      }
    }, DELAY_MS)
  })
})

function route(req, res, url, body) {
  if (url.pathname === '/main.php') {
    log.mainPhp++
    const id = `replay${++sessionCounter}`
    sessions.add(id)
    return send(res, 200, '<html><body>main</body></html>', {
      'Set-Cookie': `PHPSESSID=${id}; path=/`,
    })
  }

  if (url.pathname === '/Szczegol.php' && req.method === 'POST' && url.searchParams.get('AK') === '1') {
    log.listPosts++
    const form = new URLSearchParams(body)
    const cookie = /PHPSESSID=([^;]+)/.exec(req.headers.cookie || '')
    const missing = REQUIRED_FIELDS.filter((f) => !form.has(f))
    const model = form.get('model')
    log.lastListPost = {
      model,
      cookieValid: Boolean(cookie && sessions.has(cookie[1])),
      missingFields: missing,
      contentType: req.headers['content-type'],
    }
    if (!cookie || !sessions.has(cookie[1]) || missing.length > 0 || !MODELS.includes(model)) {
      log.listRejected++
      return send(res, 200, '<html><body>Session expired</body></html>')
    }
    return send(res, 200, listPage(model))
  }

  if (url.pathname === '/Szczegol.php' && req.method === 'GET' && url.searchParams.has('numer')) {
    log.detailGets++
    const no = url.searchParams.get('numer')
    const model = url.searchParams.get('model')
    const row = index[model] && index[model].get(no)
    const real = details[`${model}:${no}`]
    if (real) {
      log.detailReal++
      return send(res, 200, withState(real, model, no, row && row.registered))
    }
    const synthetic = synthesizeDetail(model, no)
    if (!synthetic) {
      log.detailNotFound++
      return send(res, 200, '<html><body>No record</body></html>')
    }
    log.detailSynthesized++
    return send(res, 200, withState(synthetic, model, no, row && row.registered), {
      'X-Replay-Synthesized': '1',
    })
  }

  if (url.pathname === '/__replay/add') {
    const model = url.searchParams.get('model') || 'MCM'
    const no = String((maxNo[model] || 0) + 1)
    const carId = `00630${String(9000 + Number(no) % 1000)}C`
    const registered = siteDate(new Date())
    const tr =
      `<tr bgcolor=#DEDEDF><td>${no}</td><td>${model}</td><td><A href="Szczegol.php?numer=${no}&model=${model}">${carId}</A></td>` +
      `<td>${carId}00</td><td>${registered}</td><td>151</td><td>pas de continuité replay test</td><td></td></tr>`
    injected[model].unshift(tr)
    indexRows(model, tr)
    return json(res, { model, no, carId, registered })
  }

  if (['/__replay/close', '/__replay/rework', '/__replay/qc'].includes(url.pathname)) {
    const model = url.searchParams.get('model')
    const no = url.searchParams.get('no')
    const at = siteDate(new Date())
    const key = `${model}:${no}`
    if (url.pathname !== '/__replay/qc') reworkedAt.set(key, at)
    if (url.pathname !== '/__replay/rework') qcAt.set(key, at)
    return json(res, {
      model,
      no,
      reworkedAt: reworkedAt.get(key) ?? null,
      qualityControlAt: qcAt.get(key) ?? null,
    })
  }

  if (url.pathname === '/__replay/addcode') {
    const model = url.searchParams.get('model')
    const no = url.searchParams.get('no')
    const code = url.searchParams.get('code') || '140'
    const info = url.searchParams.get('info') || 'ajoute pendant la reparation'
    const key = `${model}:${no}`
    const tr =
      `<tr bgcolor=#D8D8D8><td>${code}</td><td>fil coupe</td><td>Team1</td><td>fil</td>` +
      `<td>E17/47*1-S_V</td><td>Not applicable</td><td>${info}</td></tr>`
    extraCodes.set(key, [...(extraCodes.get(key) ?? []), tr])
    return json(res, { model, no, code, info, codesAdded: extraCodes.get(key).length })
  }

  if (url.pathname === '/__replay/log') {
    return json(res, { ...log, charset: CHARSET, rows: { MAM: index.MAM.size, MCM: index.MCM.size } })
  }

  send(res, 404, '<html><body>not found</body></html>')
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`replay site on http://127.0.0.1:${PORT}`)
  console.log(`  captures: ${CAPTURE_DIR}`)
  console.log(`  list rows: MAM ${index.MAM.size}, MCM ${index.MCM.size}`)
  console.log(`  real detail pages: ${Object.keys(details).join(', ') || 'none'}`)
  console.log(`  charset: ${CHARSET === 'utf8' ? 'UTF-8 (declared)' : 'Latin-1 (undeclared)'}`)
})
