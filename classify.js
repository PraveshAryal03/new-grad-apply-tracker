// Reads a job description and decides whether it rules out an F-1 / OPT candidate.
// Pure functions only: no network, no files.
'use strict';

const US = String.raw`(?:u\.?\s?s\.?a?\.?|united states)`;
const GAP = String.raw`[^.;!?]{0,60}`;

// Citizenship, security clearance, or export-control ("U.S. person") requirements.
const CITIZEN_PATTERNS = [
  new RegExp(String.raw`\bmust\s+(?:be|hold|have|possess)${GAP}\b${US}\s+citizen`, 'i'),
  new RegExp(String.raw`\b${US}\s+citizen(?:ship)?\b[^.;!?]{0,25}\b(?:is|are)?\s*(?:required|mandatory|only)\b`, 'i'),
  new RegExp(String.raw`\b(?:requires?|required|requirement|limited to|restricted to|open only to|only open to)${GAP}\b${US}\s+citizen`, 'i'),
  new RegExp(String.raw`\b${US}\s+citizens?\s+only\b`, 'i'),
  new RegExp(String.raw`\b(?:active|current|existing|obtain|maintain|hold|possess|require[sd]?|eligib\w+ for)${GAP}\b(?:security|secret|top secret|ts\/sci|dod|government)\s+clearance`, 'i'),
  new RegExp(String.raw`\b(?:security|secret|ts\/sci)\s+clearance${GAP}\b(?:required|is a must|mandatory)`, 'i'),
  new RegExp(String.raw`\bmust\s+be${GAP}\b${US}\s+person\b`, 'i'),
  new RegExp(String.raw`\b${US}\s+persons?\b${GAP}\b(?:required|only|as defined)`, 'i'),
  /\bITAR\b(?! and \/ or EAR Statement)/,
  /\bpublic trust\b[^.;!?]{0,40}\b(?:clearance|required)/i,
];

// Explicit refusal to sponsor, or a demand for permanent work authorization.
const NO_SPONSOR_PATTERNS = [
  /\b(?:not|unable to|cannot|can ?not|can't|won't|will not|does not|do not|doesn't|don't|no longer)\s+(?:currently\s+|presently\s+)?(?:be\s+)?(?:able to\s+)?(?:offer(?:ing)?|provid(?:e|ing)|sponsor(?:ing)?|support(?:ing)?|consider(?:ing)?)\b[^.;!?]{0,60}\b(?:sponsorship|visas?|work authorization|h-?1b|opt|cpt)\b/i,
  /\b(?:will|do|does|can|would)\s?(?:not|n't)\s+(?:be\s+)?sponsor/i,
  /\b(?:unable|not able)\s+to\s+sponsor/i,
  /\bsponsorship\b[^.;!?]{0,40}\b(?:is|are|will)\s+not\s+(?:be\s+)?(?:available|offered|provided|supported|considered)/i,
  /\bnot\s+(?:eligible|available)\s+for\b[^.;!?]{0,40}\bsponsorship/i,
  /\bno\s+(?:visa\s+|immigration\s+|work\s+|employment\s+|h-?1b\s+)?sponsorship\b/i,
  /\bwithout\b[^.;!?]{0,50}\b(?:need(?:ing)?|requir(?:e|ing)|requirement)\b[^.;!?]{0,40}\bsponsorship/i,
  /\bwithout\s+(?:company\s+|employer\s+|visa\s+|current or future\s+|future\s+)?sponsorship\b/i,
  /\b(?:not|cannot|unable)\b[^.;!?]{0,50}\b(?:f-?1|opt|cpt|stem opt)\b/i,
  /\bpermanent(?:ly)?\b[^.;!?]{0,30}\b(?:work authorization|authorized to work|right to work)/i,
];

// Explicit statement that sponsorship is offered.
const SPONSOR_PATTERNS = [
  /\b(?:visa\s+|h-?1b\s+|immigration\s+)?sponsorship\s+(?:is\s+)?(?:available|offered|provided|possible)\b/i,
  /\bwe\s+(?:will\s+|do\s+|can\s+|are able to\s+)?sponsor\b/i,
  /\b(?:offers?|provides?|eligible for)\s+(?:visa\s+|h-?1b\s+|immigration\s+)sponsorship\b/i,
  /\b(?:opt|cpt|f-?1)\b[^.;!?]{0,30}\b(?:welcome|accepted|eligible|encouraged)/i,
];

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'" };

function decodeEntities(text) {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name) => {
    const key = name.toLowerCase();
    if (ENTITIES[key] !== undefined) return ENTITIES[key];
    if (key.startsWith('#x')) return String.fromCodePoint(parseInt(key.slice(2), 16) || 32);
    if (key.startsWith('#')) return String.fromCodePoint(parseInt(key.slice(1), 10) || 32);
    return whole;
  });
}

/** Turns HTML (or JSON containing escaped HTML) into plain, single-spaced text. */
function toPlainText(raw) {
  const unescaped = String(raw)
    .replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\[nrt]/g, ' ')
    .replace(/\\"/g, '"');
  const decoded = decodeEntities(decodeEntities(unescaped));
  return decoded
    .replace(/<(?:br|\/p|\/li|\/div|\/h[1-6])\s*\/?>/gi, '. ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// Wording that marks a requirement as optional ("preferred qualifications", "a plus").
const OPTIONAL_CONTEXT = /preferred|nice to have|bonus|a plus|desired|not required/i;
const OPTIONAL_LOOKBACK_CHARS = 300;

function findSnippet(text, patterns, skipOptional = false) {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    const before = match ? text.slice(Math.max(0, match.index - OPTIONAL_LOOKBACK_CHARS), match.index) : '';
    if (match && !(skipOptional && OPTIONAL_CONTEXT.test(before + match[0]))) {
      const start = Math.max(0, match.index - 60);
      const end = Math.min(text.length, match.index + match[0].length + 80);
      return text.slice(start, end).trim();
    }
  }
  return null;
}

/**
 * @param {string} text plain-text job description
 * @returns {{ flag: 'citizen'|'nosponsor'|'sponsors'|'ok', snippet: string }}
 */
function classify(text) {
  const citizen = findSnippet(text, CITIZEN_PATTERNS, true);
  if (citizen) return { flag: 'citizen', snippet: citizen };
  const noSponsor = findSnippet(text, NO_SPONSOR_PATTERNS);
  if (noSponsor) return { flag: 'nosponsor', snippet: noSponsor };
  const sponsors = findSnippet(text, SPONSOR_PATTERNS);
  if (sponsors) return { flag: 'sponsors', snippet: sponsors };
  return { flag: 'ok', snippet: '' };
}

module.exports = { classify, toPlainText };
