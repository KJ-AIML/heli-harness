# Sources — release

## Versioning

- **Semantic Versioning 2.0.0** — the major/minor/patch contract; the key clause is that semver is a promise about *public* API surface, which is why step 1 judges "breaking" against what users depend on, not internal code.
  https://semver.org/
- **Hyrum's Law** — "with a sufficient number of users, all observable behaviors of your system will be depended on by somebody." The honest caveat to semver: the breaking/non-breaking line is a judgment call, which is why the skill routes uncertainty to the engineering compatibility question.
  https://www.hyrumslaw.com/

## Changelogs

- **Keep a Changelog (Olivier Lacan)** — the Added/Changed/Fixed/Breaking grouping, the "changelogs are for humans, not machines" principle, and the explicit anti-pattern of dumping commit logs.
  https://keepachangelog.com/

## Release engineering

- **Google SRE Book, ch. 8 "Release Engineering"** — releases as a repeatable, auditable process (hermetic builds, self-service, policy-enforced) rather than a hero activity; this skill is the solo-scale version.
  https://sre.google/sre-book/release-engineering/
- **Accelerate / DORA (Forsgren, Humble, Kim, 2018)** — deployment frequency and change-failure rate move together in high performers; small frequent releases with verification beat big rare ones. Pairs with the harness's small-batch discipline (branch unit mapping).

## Honest notes

- The develop → main flow matches the user's branch conventions (branch). Repos using pure trunk-based releases (tag main directly) skip step 3; the rest of the checklist is unchanged.
- "Don't release Friday 6pm" is operational folklore, not research; the durable form is the watching-window rule — ship when someone will see the first regression.
