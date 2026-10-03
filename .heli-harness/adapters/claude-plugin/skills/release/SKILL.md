---
name: release
description: Use when preparing, cutting, publishing, deploying, tagging, or documenting a release; require pre-release gates and post-release proof that source, tag, registry/artifact, and fresh install agree.
---

# release

Trigger: preparing, cutting, publishing, deploying, tagging, or documenting a release.

## Before mutation

Read the repository's actual release policy and determine:

- source branch and expected HEAD;
- target version/tag;
- changelog/release-note requirements;
- package/artifact build path;
- required verification gates;
- registry/deployment destination;
- rollback/recovery path.

Do not assume a release branch flow or package manager from Heli itself.

## Release sequence

Use the smallest repository-supported sequence that preserves evidence:

1. verify the intended source SHA and clean/intentional working tree;
2. run required validation;
3. prepare version/changelog/artifacts;
4. inspect the release diff/artifact;
5. create the release commit/tag when the repo policy uses them;
6. publish/deploy only when explicitly requested or authorized by documented automation policy;
7. perform post-release verification against the external destination.

Treat destructive, production, credential/policy, and irreversible release actions as S3 unless trusted repo policy establishes a narrower classification.

## Post-release proof

A release is not complete merely because the publish command exited successfully.

When applicable, verify that these surfaces agree:

- source/release commit SHA;
- annotated or policy-required Git tag;
- package/application version;
- GitHub/release artifact presence;
- exact registry version visibility;
- expected registry/dist-tag/channel;
- fresh install or `npx`/equivalent reports the released version;
- deployed/runtime health or smoke result;
- checksums/provenance/signatures when the repository requires them.

For an npm CLI package, a typical evidence set is:

```bash
git rev-parse HEAD
git tag --points-at HEAD
npm view <package>@<version> version
npm view <package> dist-tags --json
npx -y <package>@<version> --version
```

Do not hard-code these commands for non-npm repositories; use the repository's actual artifact/registry system.

## Processing and partial states

Registry or deployment systems may accept a release before it becomes externally visible.

If publication reports processing/pending:

- do not blindly republish;
- distinguish "publish accepted" from "externally visible";
- inspect the exact version and release channel/tag;
- preserve the source/tag state while waiting for external visibility.

If a release script times out or is interrupted, inspect Git status, version files, commits, tags, and external state before rerunning. Resume only the missing steps rather than duplicating irreversible actions.

## Rules

- Do not publish or deploy without explicit user request or documented automation authority.
- Do not claim success from a local version bump alone.
- Do not claim registry success until the exact released version is externally queryable.
- Do not move or recreate an existing tag blindly.
- Do not expose registry credentials, tokens, OTPs, or secrets.
- Capture warnings and residual risks separately from release blockers.

## Output

```text
Release:
Source SHA:
Tag:
Validation:
Artifact/registry:
Channel/dist-tag:
Fresh-install/runtime proof:
Warnings:
Residual risk:
Status: READY | PUBLISHED-PENDING | VERIFIED | BLOCKED
```
