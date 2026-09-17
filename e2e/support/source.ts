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

/** The site name every page title carries, in lib/seo.ts. */
export const SITE_NAME = stringConst('src/lib/seo.ts', 'SITE_NAME');

/**
 * `key: '<string>'` or `key: { <field>: '<string>'` inside the object literal
 * `const NAME ... = { ... };` in `file`, or a thrown error naming all three.
 */
export function objectEntry(file: string, name: string, key: string, field?: string): string {
  const text = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
  const body = text.match(new RegExp(`\\bconst ${name}\\b[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};`))?.[1];
  const value = field ? `\\{\\s*${field}:\\s*` : '';
  const m = body?.match(new RegExp(`\\b${key}:\\s*${value}(['"])(.*?)\\1`));
  if (!m) throw new Error(`${file} no longer has ${name}.${key}${field ? `.${field}` : ''} as a string; update e2e/support/source.ts`);
  return m[2];
}

export type StandingPage = 'about' | 'terms' | 'privacy' | 'safety';

/**
 * The document title of a standing page. The words come from lib/seo.ts's
 * PAGE_META; the `<title> — <site>` shape is applyPageMeta's.
 */
export function pageTitle(page: StandingPage): string {
  return `${objectEntry('src/lib/seo.ts', 'PAGE_META', page, 'title')} — ${SITE_NAME}`;
}

/**
 * The label of a standing page's tab in the About panel, which is also the
 * heading of a legal page: PAGE_TITLES in LegalPages.tsx, and the About tab's
 * own label in AboutPanel.tsx.
 */
export function tabLabel(page: StandingPage): string {
  if (page === 'about') {
    const text = fs.readFileSync(path.join(process.cwd(), 'src/components/AboutPanel.tsx'), 'utf8');
    const m = text.match(/\{\s*key:\s*'about',\s*label:\s*'([^']+)'\s*\}/);
    if (!m) throw new Error("AboutPanel.tsx no longer labels the about tab with a string; update e2e/support/source.ts");
    return m[1];
  }
  return objectEntry('src/components/LegalPages.tsx', 'PAGE_TITLES', page);
}
