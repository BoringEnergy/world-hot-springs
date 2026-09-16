/**
 * Facts the specs need that live in src/ but are not exported.
 *
 * A spec that writes `'whs.welcomed'` or the default page title keeps a
 * second copy of a fact, and the copy is what drifts: the component changes,
 * the spec goes on asserting the old string, and the test fails for a reason
 * nobody meant to test -- or, worse, a storage-key rename makes a seeding
 * fixture silently seed nothing. So the value is read from the one place it
 * is defined.
 *
 * Reading source text rather than importing: these constants are
 * module-private in files that pull in React and the store. Exporting them is
 * the better fix and belongs to the change that next touches those files.
 */
import fs from 'node:fs';
import path from 'node:path';

/** `const NAME = '<string>';` in `file`, or a thrown error naming both. */
export function stringConst(file: string, name: string): string {
  const text = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
  const m = text.match(new RegExp(`\\bconst ${name}\\s*=\\s*(['"])(.*?)\\1\\s*;`));
  if (!m) throw new Error(`${file} no longer defines \`const ${name} = '...'\`; update e2e/support/source.ts`);
  return m[2];
}

/** localStorage key the welcome panel marks itself seen under. */
export const WELCOMED_KEY = stringConst('src/components/WelcomePanel.tsx', 'SEEN_KEY');

/** localStorage key the temperature unit is remembered under. */
export const UNITS_KEY = stringConst('src/store/useStore.ts', 'UNITS_KEY');

/** The title of the map view, set by applyDefaultMeta. */
export const DEFAULT_TITLE = stringConst('src/lib/seo.ts', 'DEFAULT_TITLE');
