# Reporting a problem

Two kinds of report, and the second one matters more than the first.

## A spring that should not be on the map

**This is the report we most want, and it is not a security bug — it is the
project's core promise.** If you look after a spring on this map, or you are
part of the community around one, and you want it gone: say so. You do not
need to prove ownership and you do not need to justify it. Removal is the
default answer, it is permanent, and it survives future data imports because
exclusions are stored by geographic radius rather than by upstream id.

If opening a public issue would itself draw attention to the place, **do not
open one.** Contact the maintainers privately instead. We will not publish
the request, and we will not publish the coordinates in the process of acting
on it.

Every record carries a permanent link — the **Link** button on its card, or
`/s/<id>`. Sending that is enough; you do not have to describe the location.

## A software vulnerability

This is a static site. There is no backend, no database, no authentication, no
user accounts and no server-side code, so the attack surface is small by
construction: the realistic classes are supply-chain compromise of a build
dependency, a cross-site-scripting vector in how record fields are rendered,
and anything that could cause the privacy filter to fail open.

That last one is the severe case. **Any defect that causes an excluded spring
to appear in a build output is treated as the highest severity in this
project**, above anything that affects the site's availability.

Report privately rather than by public issue. Include the version or commit,
what you did, and what you observed. We will confirm receipt, tell you what we
find, and credit you unless you would rather we didn't.

## Out of scope

Reports about the accuracy of a temperature, a price or an opening time are
corrections, not vulnerabilities — see [CONTRIBUTING.md](CONTRIBUTING.md).
Missing hardening headers on a static site, absent rate limiting, and the fact
that the dataset is downloadable in bulk are all deliberate and documented.
