// Reads each open job's description and records whether it rules out F-1 / OPT candidates.
// Results are cached in scan-cache.json so later runs only read new postings.
'use strict';
const fs = require('fs');
const path = require('path');
const { classify } = require('./classify');
const { fetchDescription, REFUSAL_STATUSES, UNREADABLE_ATS } = require('./fetchers');

const CACHE_PATH = path.join(__dirname, 'scan-cache.json');
const PARALLEL_SITES = 8;
const PAUSE_BETWEEN_REQUESTS_MS = 250;
const RETRY_UNREADABLE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
const SAVE_EVERY = 100;
const MAX_FAILURES_IN_A_ROW = 3;
const SHARED_API_ATS = new Set(['Greenhouse', 'Lever', 'Ashby', 'Workable', 'SmartRecruiters']);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function loadCache() {
  if (!fs.existsSync(CACHE_PATH)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.warn(`Ignoring unreadable ${CACHE_PATH}: ${error.message}`);
    return {};
  }
}

function saveCache(cache) {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache));
}

function needsScan(job, cache, now) {
  const entry = cache[job.id];
  if (!entry) return true;
  return entry.flag === 'unknown' && !UNREADABLE_ATS.has(job.ats) && now - entry.at > RETRY_UNREADABLE_AFTER_MS;
}

// Jobs on the same site are read one after another, so no single site sees a burst.
function groupBySite(jobs) {
  const groups = new Map();
  for (const job of jobs) {
    const key = SHARED_API_ATS.has(job.ats) ? job.ats : new URL(job.u).hostname;
    groups.set(key, [...(groups.get(key) || []), job]);
  }
  return [...groups.values()].sort((a, b) => b.length - a.length);
}

async function scanJob(job) {
  const text = await fetchDescription(job);
  return text ? classify(text) : { flag: 'unknown', snippet: '' };
}

async function scanSite(jobs, record) {
  let refused = false;
  let failuresInARow = 0;
  for (const job of jobs) {
    let result = { flag: 'unknown', snippet: '' };
    if (!refused) {
      try {
        result = await scanJob(job);
        failuresInARow = 0;
      } catch (error) {
        failuresInARow += 1;
        // Stop asking a site that refuses automated readers or keeps timing out.
        refused = REFUSAL_STATUSES.has(error.status) || failuresInARow >= MAX_FAILURES_IN_A_ROW;
      }
      await sleep(PAUSE_BETWEEN_REQUESTS_MS);
    }
    record(job, result);
  }
}

/**
 * @param {Array<{id: string, u: string, t: string, ats: string}>} jobs
 * @returns {Promise<Record<string, {flag: string, snippet: string, at: number}>>}
 */
async function scanJobs(jobs) {
  const now = Date.now();
  const cache = loadCache();
  const pending = jobs.filter((job) => needsScan(job, cache, now));
  const sites = groupBySite(pending);
  let results = { ...cache };
  let done = 0;

  const record = (job, result) => {
    results = { ...results, [job.id]: { flag: result.flag, snippet: result.snippet.slice(0, 300), at: now } };
    done += 1;
    if (done % SAVE_EVERY === 0) {
      saveCache(results);
      console.log(`  checked ${done} of ${pending.length} new postings`);
    }
  };

  console.log(`Reading ${pending.length} new job descriptions (${jobs.length - pending.length} already checked)...`);
  const queue = [...sites];
  const worker = async () => {
    for (let site = queue.shift(); site; site = queue.shift()) await scanSite(site, record);
  };
  await Promise.all(Array.from({ length: PARALLEL_SITES }, worker));

  const openIds = new Set(jobs.map((job) => job.id));
  const trimmed = Object.fromEntries(Object.entries(results).filter(([id]) => openIds.has(id)));
  saveCache(trimmed);
  return trimmed;
}

module.exports = { scanJobs };
