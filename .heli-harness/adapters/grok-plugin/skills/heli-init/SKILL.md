---
name: heli-init
description: Use when bootstrapping project facts/profile context for a Heli v0.10 linked project or an embedded compatibility workspace.
---

# Heli Init

Bootstrap or refresh descriptive project/repository facts without changing product source.

## 1. Resolve layout first

Run:

```bash
heli status
```

- **Linked v0.10 project:** project config/overlays live under `.heli/`; use Heli CLI state to resolve target/resource context.
- **Embedded compatibility workspace:** use `.heli-harness/` profile/workspace paths.

Do not infer linked authority from old embedded state files.

## 2. Inspect the project/repository

- Read repo-local docs, package/build/test configuration, and relevant source structure.
- Identify build/test/package-manager facts from evidence.
- Do **not** edit product source code as part of profile initialization.
- Preserve dirty user work.

## 3. Create or update the profile

Linked mode:

```text
.heli/profiles/<repo>.md
```

Embedded compatibility:

```text
.heli-harness/profiles/<repo>.md
```

Record:

- observed stack;
- existing patterns;
- recommended conventions;
- known tech debt;
- forbidden patterns;
- safer alternatives;
- command tiers/risk notes;
- repo risks;
- exceptions;
- evidence paths;
- policy references.

Observed code is a fact, not automatically a recommendation.

## 4. Durable work record only when needed

Profile initialization does not require a named task merely to become authorized.

Create/update a durable work record when the work spans sessions, needs handoff/coordination, or carries significant verification/diagnosis obligations. In embedded compatibility mode, the existing task-state workflow remains available.

## Command classification

Classify discovered commands by actual side effects/cost:

- read/audit only;
- non-mutating validation;
- local mutation/build;
- network/API/cost-bearing;
- release/publish/deploy;
- destructive/secret/outside-scope.

Risk tiers summarize impact; they do not grant authority.

## Safety

- Do not edit target source during profile bootstrap.
- Do not commit/push/release.
- Do not install dependencies or spend API credits without the applicable policy/grant.
- Confirm target/resource identity when ambiguous.
- Do not copy credentials or secret values into profiles/evidence.
