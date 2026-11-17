// Downloads the SimplifyJobs New-Grad listings and builds jobs.html (a local apply tracker).
// Usage: node build.js
'use strict';
const fs = require('fs');
const path = require('path');
const { classify } = require('./classify');
const { scanJobs } = require('./scan');

const SOURCE_URL =
  'https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json';
const TEMPLATE_PATH = path.join(__dirname, 'template.html');
const OUTPUT_PATH = path.join(__dirname, 'jobs.html');

const ATS_BY_HOST = [
  ['greenhouse.io', 'Greenhouse'],
  ['lever.co', 'Lever'],
  ['ashbyhq.com', 'Ashby'],
  ['workable.com', 'Workable'],
  ['smartrecruiters.com', 'SmartRecruiters'],
  ['myworkdayjobs.com', 'Workday'],
  ['myworkdaysite.com', 'Workday'],
  ['icims.com', 'iCIMS'],
  ['oraclecloud.com', 'Oracle'],
  ['successfactors', 'SuccessFactors'],
  ['jobvite.com', 'Jobvite'],
  ['taleo.net', 'Taleo'],
  ['simplify.jobs', 'Simplify'],
];
// These usually need no account: one page, resume upload, submit.
const QUICK_ATS = new Set(['Greenhouse', 'Lever', 'Ashby', 'Workable', 'SmartRecruiters']);

const CATEGORY_ALIASES = {
  'Software Engineering': 'Software',
  'Data Science, AI & Machine Learning': 'AI/ML/Data',
};

const SECURITY_PATTERN =
  /secur|cyber|infosec|\bsoc\b|threat|penetration|pentest|vulnerab|incident resp|\bgrc\b|\biam\b|red team|malware|forensic|cryptograph/i;

function parseHttpUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

function detectAts(url) {
  const host = url.hostname.toLowerCase();
  const match = ATS_BY_HOST.find(([needle]) => host.includes(needle));
  return match ? match[1] : 'Other';
}

function toRecord(raw) {
  const url = parseHttpUrl(raw.url);
  if (!url || typeof raw.id !== 'string') return null;
  const title = String(raw.title || '').trim();
  const ats = detectAts(url);
  return {
    id: raw.id,
    c: String(raw.company_name || '').trim(),
    t: title,
    l: Array.isArray(raw.locations) ? raw.locations.map(String) : [],
    u: url.href,
    d: Number(raw.date_posted) || 0,
    cat: CATEGORY_ALIASES[raw.category] || String(raw.category || 'Other'),
    sp: String(raw.sponsorship || 'Other'),
    ats,
    q: QUICK_ATS.has(ats),
    sec: SECURITY_PATTERN.test(title),
  };
}

function dedupeByUrl(records) {
  const seen = new Set();
  return records.filter((r) => (seen.has(r.u) ? false : (seen.add(r.u), true)));
}

async function fetchListings() {
  const response = await fetch(SOURCE_URL);
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error('Unexpected data format: expected a list of jobs');
  return data;
}

const REPO_FLAGS = {
  'U.S. Citizenship is Required': 'citizen',
  'Does Not Offer Sponsorship': 'nosponsor',
};
const SNIPPET_CHARS = 220;

// Combines three sources, strongest first: the repo's own label, the job title, the posting text.
function withWorkAuthorization(record, scanned) {
  const fromRepo = REPO_FLAGS[record.sp];
  if (fromRepo) return { ...record, w: fromRepo, ws: '' };
  const fromTitle = classify(record.t);
  if (fromTitle.flag === 'citizen' || fromTitle.flag === 'nosponsor') return { ...record, w: fromTitle.flag, ws: '' };
  const entry = scanned[record.id] || { flag: 'unknown', snippet: '' };
  const blocked = entry.flag === 'citizen' || entry.flag === 'nosponsor';
  return { ...record, w: entry.flag, ws: blocked ? entry.snippet.slice(0, SNIPPET_CHARS) : '' };
}

async function main() {
  const raw = await fetchListings();
  const open = raw.filter((x) => x && x.active && x.is_visible);
  const listed = dedupeByUrl(open.map(toRecord).filter(Boolean)).sort((a, b) => b.d - a.d);
  if (listed.length === 0) throw new Error('No open jobs found - the data format may have changed');
  const scanned = await scanJobs(listed);
  const records = listed.map((record) => withWorkAuthorization(record, scanned));

  // Escape "<" so job text can never close the <script> tag it is embedded in.
  const payload = JSON.stringify({ built: Date.now(), jobs: records }).replace(/</g, '\\u003c');
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  if (!template.includes('__JOB_DATA__')) throw new Error('template.html is missing __JOB_DATA__');
  fs.writeFileSync(OUTPUT_PATH, template.replace('__JOB_DATA__', () => payload));

  const quick = records.filter((r) => r.q).length;
  const security = records.filter((r) => r.sec).length;
  console.log(`Built ${OUTPUT_PATH}`);
  console.log(`${records.length} open jobs | ${quick} quick-apply | ${security} security-related`);
  const count = (flag) => records.filter((r) => r.w === flag).length;
  console.log(
    `Work authorization: ${count('citizen')} citizenship/clearance | ${count('nosponsor')} no sponsorship | ` +
      `${count('sponsors')} say they sponsor | ${count('ok')} no restriction found | ${count('unknown')} not checked`
  );
}

main().catch((error) => {
  console.error(`Build failed: ${error.message}`);
  process.exit(1);
});
