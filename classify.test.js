'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classify, toPlainText } = require('./classify');

const CASES = [
  ['citizen', 'Applicants must be a U.S. citizen to be considered.'],
  ['citizen', 'U.S. Citizenship is required for this position.'],
  ['citizen', 'This role requires US citizenship due to government contracts.'],
  ['citizen', 'Must be able to obtain and maintain a Secret clearance.'],
  ['citizen', 'An active TS/SCI clearance is needed. Candidates must possess an active TS/SCI clearance.'],
  ['citizen', 'Because of ITAR regulations, candidates need to verify status.'],
  ['citizen', 'Candidates must be a U.S. person as defined by export law.'],
  ['nosponsor', 'We are unable to sponsor visas for this role.'],
  ['nosponsor', 'This position is not eligible for visa sponsorship.'],
  ['nosponsor', 'The company will not sponsor applicants for work visas.'],
  ['nosponsor', 'Must be authorized to work in the US without the need for sponsorship now or in the future.'],
  ['nosponsor', 'Applicants must be authorized to work without sponsorship.'],
  ['nosponsor', 'Sponsorship is not available for this position.'],
  ['nosponsor', 'We do not offer employment visa sponsorship at this time.'],
  ['nosponsor', 'No sponsorship available.'],
  ['nosponsor', 'We cannot consider candidates on F-1 OPT.'],
  ['sponsors', 'Visa sponsorship is available for this position.'],
  ['sponsors', 'We will sponsor qualified candidates.'],
  ['ok', 'Preferred Qualifications: An active U.S. government Public Trust or security clearance.'],
  ['ok', "labels: 'EEO Statement','ITAR and / or EAR Statement','Veteran Statement'"],
  ['ok', 'Build scalable services in Python and AWS with a great team.'],
  ['ok', 'We consider applicants without regard to race, religion, citizenship, or veteran status.'],
  ['ok', 'Will you now or in the future require sponsorship for employment visa status?'],
  ['ok', 'You must be legally authorized to work in the United States.'],
  ['ok', 'We keep your data secret and clear every hurdle; required skills include Go.'],
];

for (const [expected, text] of CASES) {
  test(`${expected}: ${text.slice(0, 60)}`, () => {
    assert.equal(classify(text).flag, expected);
  });
}

test('citizenship outranks a sponsorship statement', () => {
  assert.equal(classify('We will sponsor relocation. U.S. citizenship is required.').flag, 'citizen');
});

test('toPlainText strips tags, entities and JSON escapes', () => {
  const html = '&lt;p&gt;Must be a U.S.&amp;nbsp;citizen&lt;/p&gt;\\u003cb\\u003eNow\\u003c/b\\u003e';
  assert.equal(toPlainText(html), 'Must be a U.S. citizen. Now');
});
