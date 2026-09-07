import test from 'node:test';
import assert from 'node:assert/strict';
import { matchNcei, MATCH_RADIUS_M } from './lib/ncei-match.mjs';

/** A minimal atlas record: only the fields the matcher reads. */
const atlas = (id, lat, lng, name) => ({ id, name, location: { lat, lng } });
/** ~N metres north of a latitude, for just-inside/just-outside cases. */
const northOf = (lat, metres) => lat + metres / 111320;

test('the radius is 200 m, measured not assumed', () => {
  assert.equal(MATCH_RADIUS_M, 200);
});

test('a spring within the radius sharing a name matches', () => {
  const { matched } = matchNcei(
    [{ state: 'WY', lat: 44.7, lng: -110.7, name: 'BIJAH SPRING', celsius: 60, qualitative: null }],
    [atlas('whs_a', northOf(44.7, 75), -110.7, 'Bijah Springs')],
  );
  assert.equal(matched.length, 1);
  assert.equal(matched[0].id, 'whs_a');
  assert.equal(matched[0].celsius, 60);
});

test('just outside the radius does not match', () => {
  const { matched, unmatched } = matchNcei(
    [{ state: 'WY', lat: 44.7, lng: -110.7, name: 'BIJAH SPRING', celsius: 60, qualitative: null }],
    [atlas('whs_a', northOf(44.7, 201), -110.7, 'Bijah Springs')],
  );
  assert.equal(matched.length, 0);
  assert.equal(unmatched.length, 1);
});

test('a different name inside the radius does not match', () => {
  const { matched, rejected } = matchNcei(
    [{ state: 'WY', lat: 44.7, lng: -110.7, name: 'BIJAH SPRING', celsius: 60, qualitative: null }],
    [atlas('whs_a', northOf(44.7, 50), -110.7, 'Emerald Pool')],
  );
  assert.equal(matched.length, 0);
  assert.equal(rejected[0].reason, 'name disagreement');
});

test('an unnamed side is not treated as a name disagreement', () => {
  const { matched } = matchNcei(
    [{ state: 'WY', lat: 44.7, lng: -110.7, name: 'BERYL SPRING', celsius: 60, qualitative: null }],
    [atlas('whs_a', northOf(44.7, 54), -110.7, null)],
  );
  assert.equal(matched.length, 1);
});

test('name comparison is containment, so Spring and Springs are the same place', () => {
  const { matched } = matchNcei(
    [
      {
        state: 'WY',
        lat: 44.7,
        lng: -110.7,
        name: 'ARTISTS PAINTPOTS',
        celsius: 60,
        qualitative: null,
      },
    ],
    [atlas('whs_a', northOf(44.7, 100), -110.7, "Artists' Paintpots")],
  );
  assert.equal(matched.length, 1);
});

test('two NCEI rows contending for one spring are BOTH rejected, never guessed', () => {
  // Yellowstone: NOAA lists named groups, OSM lists individual vents. Picking
  // the closer one would attach a group's temperature to a single vent.
  const { matched, rejected } = matchNcei(
    [
      { state: 'WY', lat: 44.7, lng: -110.7, name: 'SHELF SPRING', celsius: 60, qualitative: null },
      {
        state: 'WY',
        lat: northOf(44.7, 20),
        lng: -110.7,
        name: 'SHELF SPRING',
        celsius: 70,
        qualitative: null,
      },
    ],
    [atlas('whs_a', northOf(44.7, 10), -110.7, 'Shelf Spring')],
  );
  assert.equal(matched.length, 0);
  assert.equal(rejected.length, 2);
  for (const r of rejected) {
    assert.equal(r.reason, 'ambiguous: two NCEI rows contend for one spring');
  }
});

test('"hot" inside one name and not the other is not a disagreement', () => {
  // WILBUR SPRINGS / Wilbur Hot Springs is one place. Plain containment fails
  // only because "hot" is interpolated into the middle of the other name.
  const { matched } = matchNcei(
    [{ state: 'CA', lat: 39.039, lng: -122.421, name: 'WILBUR SPRINGS', celsius: 67, qualitative: null }],
    [atlas('whs_a', northOf(39.039, 27), -122.421, 'Wilbur Hot Springs')],
  );
  assert.equal(matched.length, 1);
});

test('the same holds for "warm"', () => {
  const { matched } = matchNcei(
    [{ state: 'OR', lat: 44, lng: -121, name: 'NIMROD SPRINGS', celsius: 30, qualitative: null }],
    [atlas('whs_a', northOf(44, 40), -121, 'Nimrod Warm Springs')],
  );
  assert.equal(matched.length, 1);
});

test('a generic name never becomes a wildcard', () => {
  // "SPRING (HOT)" reduces to "spring" once the qualifier is dropped, and
  // "spring" is a substring of nearly every spring name on earth. Allowing it
  // to match would silently attach NOAA's reading to whatever happens to be
  // nearest -- here, a spring 59 m away with an entirely different name.
  const { matched, rejected } = matchNcei(
    [{ state: 'NM', lat: 33.2, lng: -108.2, name: 'SPRING (HOT)', celsius: 50, qualitative: null }],
    [atlas('whs_a', northOf(33.2, 59), -108.2, 'Gila / Lightfeather Hot Springs')],
  );
  assert.equal(matched.length, 0);
  assert.equal(rejected[0].reason, 'name disagreement');
});

test('two generic names still match, because that is the unnamed case', () => {
  // Neither name carries information, so the match rests on proximity alone --
  // which is exactly how two unnamed springs are already treated.
  const { matched } = matchNcei(
    [{ state: 'NV', lat: 40, lng: -117, name: 'HOT SPRING', celsius: 50, qualitative: null }],
    [atlas('whs_a', northOf(40, 77), -117, 'Hot Spring')],
  );
  assert.equal(matched.length, 1);
});

test('a qualitative row matches and carries its word, not a number', () => {
  const { matched } = matchNcei(
    [
      {
        state: 'AK',
        lat: 52.84,
        lng: -169.9,
        name: 'CHUGINADAK HOT SPRINGS',
        celsius: null,
        qualitative: 'hot',
      },
    ],
    [atlas('whs_a', 52.84, -169.9, 'Chuginadak Hot Springs')],
  );
  assert.equal(matched[0].celsius, null);
  assert.equal(matched[0].qualitative, 'hot');
});
