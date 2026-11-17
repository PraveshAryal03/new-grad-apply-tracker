// Downloads the description text for one job posting, using each job board's public data
// endpoint where one exists and the plain web page otherwise.
'use strict';
const { toPlainText } = require('./classify');

const TIMEOUT_MS = 20000;
const MIN_DESCRIPTION_CHARS = 400;
// The site is telling automated readers to stay away; callers should stop asking it.
const REFUSAL_STATUSES = new Set([401, 403, 429]);
// Workday answers every automated request with "429 Too Many Requests", so it is never asked.
const UNREADABLE_ATS = new Set(['Workday']);
const HEADERS = {
  'User-Agent': 'job-list-checker/1.0',
  Accept: 'application/json, text/html;q=0.9, */*;q=0.5',
};

async function fetchText(url) {
  const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' });
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.text();
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

async function greenhouse(url) {
  const path = url.pathname.match(/^\/(?:embed\/job_app|([^/]+)\/jobs\/(\d+))/);
  const board = (path && path[1]) || url.searchParams.get('for');
  const id = (path && path[2]) || url.searchParams.get('token');
  if (!board || !id) return null;
  const data = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${id}`);
  return data.content || null;
}

async function lever(url) {
  const match = url.pathname.match(/^\/([^/]+)\/([0-9a-f-]{36})/i);
  if (!match) return null;
  const apiHost = url.hostname.includes('.eu.') ? 'api.eu.lever.co' : 'api.lever.co';
  const data = await fetchJson(`https://${apiHost}/v0/postings/${match[1]}/${match[2]}`);
  const lists = (data.lists || []).map((list) => `${list.text}. ${list.content}`).join(' ');
  return [data.descriptionPlain, lists, data.additionalPlain].filter(Boolean).join(' ');
}

const ashbyBoards = new Map();
async function ashby(url) {
  const match = url.pathname.match(/^\/([^/]+)\/([0-9a-f-]{36})/i);
  if (!match) return null;
  const org = decodeURIComponent(match[1]);
  if (!ashbyBoards.has(org)) {
    const pending = fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(org)}`)
      .then((board) => new Map((board.jobs || []).map((job) => [job.id, job.descriptionHtml || job.descriptionPlain])));
    ashbyBoards.set(org, pending);
  }
  const jobs = await ashbyBoards.get(org);
  return jobs.get(match[2]) || null;
}

async function workable(url) {
  const match = url.pathname.match(/^\/([^/]+)\/j\/([A-Z0-9]+)/i);
  if (!match) return null;
  const data = await fetchJson(`https://apply.workable.com/api/v2/accounts/${match[1]}/jobs/${match[2]}`);
  return [data.description, data.requirements, data.benefits].filter(Boolean).join(' ') || null;
}

async function smartRecruiters(url) {
  const match = url.pathname.match(/^\/([^/]+)\/(\d+)/);
  if (!match) return null;
  const data = await fetchJson(`https://api.smartrecruiters.com/v1/companies/${match[1]}/postings/${match[2]}`);
  const sections = (data.jobAd && data.jobAd.sections) || {};
  return Object.values(sections).map((section) => section && section.text).filter(Boolean).join(' ') || null;
}

const API_FETCHERS = {
  Greenhouse: greenhouse,
  Lever: lever,
  Ashby: ashby,
  Workable: workable,
  SmartRecruiters: smartRecruiters,
};

// A page counts as a real description only if it mentions the job title; otherwise it is
// probably an empty shell that fills in its content with JavaScript.
function mentionsTitle(text, title) {
  const words = title.toLowerCase().match(/[a-z]{4,}/g) || [];
  const haystack = text.toLowerCase();
  return words.length === 0 || words.slice(0, 3).some((word) => haystack.includes(word));
}

/**
 * @param {{ u: string, t: string, ats: string }} job
 * @returns {Promise<string|null>} plain description text, or null when it could not be read
 * @throws when the site refuses automated readers (see REFUSAL_STATUSES) or is unreachable
 */
async function fetchDescription(job) {
  if (UNREADABLE_ATS.has(job.ats)) return null;
  const url = new URL(job.u);
  const viaApi = API_FETCHERS[job.ats];
  if (viaApi) {
    try {
      const raw = await viaApi(url);
      const text = raw ? toPlainText(raw) : '';
      if (text.length >= MIN_DESCRIPTION_CHARS) return text;
    } catch (error) {
      if (REFUSAL_STATUSES.has(error.status)) throw error;
      // Otherwise fall through to reading the web page itself.
    }
  }
  const page = toPlainText((await fetchText(job.u)).replace(/<style[\s\S]*?<\/style>/gi, ' '));
  return page.length >= MIN_DESCRIPTION_CHARS * 3 && mentionsTitle(page, job.t) ? page : null;
}

module.exports = { fetchDescription, REFUSAL_STATUSES, UNREADABLE_ATS };
