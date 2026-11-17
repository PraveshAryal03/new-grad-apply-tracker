# New Grad Apply Tracker

A local, single-page tracker for working through the open positions in
[SimplifyJobs/New-Grad-Positions](https://github.com/SimplifyJobs/New-Grad-Positions).
It downloads the repo's live job data, reads each posting for work-authorization
requirements, and builds one HTML page where you filter, open, and tick off applications.

No dependencies beyond Node.js 18 or newer.

## Use

```bash
node build.js      # download the list, check new postings, write jobs.html
```

Then open `jobs.html` in a browser. On Windows, double-clicking `refresh.cmd` does both.

The first run reads every posting and takes several minutes. Later runs only read
postings that are new since the last run.

## What the page does

- **Role focus**: Software, Security, AI/ML/Data, or everything.
- **Posted within**: 7, 14 or 30 days.
- **Quick-apply only**: keeps jobs on Greenhouse, Lever, Ashby, Workable and
  SmartRecruiters, which usually need no account.
- **Work authorization**: hides postings that require U.S. citizenship or a security
  clearance, or that say they do not sponsor. Flagged jobs show the sentence that
  triggered the flag.
- **Open next 5 in tabs**, **Mark applied**, **Skip**, and **Export applied (CSV)**.
  Progress is stored in the browser's local storage.

## Limits of the work-authorization check

- It is a text match on the posting, so it can be wrong. Read the quoted sentence.
- Workday postings are not checked, because Workday refuses automated readers. They are
  labelled "posting not checked".
- A posting with no flag is not a promise of sponsorship; most postings do not mention it.

## Files

| File | Purpose |
|---|---|
| `build.js` | Downloads the listings and writes `jobs.html` from `template.html` |
| `scan.js` | Reads postings site by site and caches results in `scan-cache.json` |
| `fetchers.js` | Gets a posting's description from each job board |
| `classify.js` | Decides what a description says about citizenship and sponsorship |
| `classify.test.js` | Tests for the classifier (`node --test`) |
| `template.html` | The tracker page |

Job data belongs to the SimplifyJobs repository and the employers who posted it.
