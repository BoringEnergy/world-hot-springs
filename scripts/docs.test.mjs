/**
 * The numbers in the README must match the build that produced them.
 *
 * They drifted: the README claimed 6,470 while summary.json said 6,471. A
 * count nobody checks is a count that quietly becomes wrong, and it is the
 * first number a stranger reads about this project.
 *
 * Plain string comparison rather than regex, deliberately -- the assertion
 * message can then print the exact line the README should contain, which is
 * the whole value of the test when it fails.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const README = fs.readFileSync('README.md', 'utf8');
const SUMMARY = JSON.parse(fs.readFileSync('data/summary.json', 'utf8'));

test('the README headline count matches summary.json', () => {
  const want = `**${SUMMARY.total.toLocaleString('en-US')} springs across ${SUMMARY.countries} countries**`;
  assert.ok(README.includes(want), `README should contain: ${want}`);
});

test('the README coverage table matches summary.json', () => {
  // Rounded to whole percent, as the table presents them. The temperature row
  // is bolded in the README because 1% is the point the whole project makes.
  const rows = [
    ['Temperature', 'temperature', true],
    ['Price', 'price', false],
    ['Hours', 'hours', false],
    ['Clothing policy', 'clothing', false],
  ];
  for (const [label, field, bold] of rows) {
    const pct = Math.round((SUMMARY.coverage[field] / SUMMARY.total) * 100);
    const cell = bold ? `**${pct}%**` : `${pct}%`;
    const want = `| ${label} | ${cell} |`;
    assert.ok(
      README.includes(want),
      `README should contain: ${want}  (${SUMMARY.coverage[field]} of ${SUMMARY.total})`,
    );
  }
});

test('CONTRIBUTING does not tell contributors to use an OSM id', () => {
  // Identities are whs_ + 12 hex. The old `osm-node-123456789` example
  // produced invalid submissions from anyone who read only that section.
  const CONTRIBUTING = fs.readFileSync('CONTRIBUTING.md', 'utf8');
  assert.ok(!CONTRIBUTING.includes('osm-node-'), 'use a whs_ id in examples');
});
