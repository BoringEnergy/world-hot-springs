# What we deliberately leave off the map

This is the part of the project that makes the dataset smaller on purpose.

## The rule

**Truly hidden local springs are excluded from the public map and dataset,
permanently.** We do not track them, index them, geocode them, store them in a
private column, or hold them for a later release. If a spring is known only to
the people who live near it and look after it, and they do not want it
publicised, it stays off. Forever.

There is no unicorn mode. There is no login that reveals more pins. There is no
"request access" form. Those features are not unbuilt — they are refused. A
product that quietly maintains the secret list is worse than one that never
collected it, because the list is the thing that leaks.

## Why

A well-known spring can absorb visitors: it has a car park, a maintainer, a
drainage plan, and often a till. An unmarked pool in a riverbed has none of
that. Publishing its coordinates does not democratise access to it; it converts
it into a different, worse place within about two seasons — trampled banks,
litter, a landowner who closes the access track, and locals who stop telling
anyone anything.

The people who know these places told someone in confidence. Indexing that
confidence at global scale, because we technically can, is not neutral.

## How the rule is enforced in code

- **`data/private/exclusions.json`** holds the exclusion rules. It is gitignored
  and never published. Publishing a list of the places we hid would defeat the
  entire point.
- Exclusions match by OSM id, by **geographic radius**, and by name pattern. The
  radius match is what makes removal durable: a spring stays excluded even if it
  is re-mapped upstream tomorrow under a brand new id, or if a future import
  rediscovers it from a different source.
- The filter runs **last** in the build, after normalisation and before any
  output is written, so nothing can slip past it via a new ingest path.
- The build asserts that no record in the public dataset carries
  `unicorn !== false` and **refuses to write any output** if one does.
- A malformed exclusion list is a **fatal error**, never an empty one. A parse
  failure that silently degraded to "no exclusions" would publish exactly what
  the file exists to protect.

## Requesting removal

If you look after a spring on this map, or you are part of the community around
one, and you want it gone: say so. We do not require you to prove ownership, and
we do not ask you to justify it. Removal is the default answer, it is permanent,
and it survives future data imports.

Open an issue with the spring's name or coordinates, or contact the maintainers
privately if the issue itself would draw attention to it. Private contact is
better and we will not publish the request.

## What we also exclude, automatically

- Springs tagged `access=private` or `access=no` upstream. Those are somebody's
  property, not a destination.
- Geysers that are not bathable. Hot water, wrong use.

## What we don't do

- No scraping of private forums, closed groups, or DMs.
- No accepting "secret" locations from users who are not the ones entitled to
  share them.
- No inferring hidden locations from trail data, photo EXIF, or clustering.
- No aggressive SEO of small springs, which is a slower version of the same
  harm.
