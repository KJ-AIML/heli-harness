# Release Policy

Scope:

- Version bumps, changelog updates, tags, pushes, releases, and publish actions.

## Required

- Verify the version and changelog agree before tagging.
- Run the release validation checklist before push and release.
- Confirm target repo context before release, publish, or deploy actions in multi-repo workspaces.
- Record the release commit, tag, and verification evidence.

## Recommended

- Keep release commits focused on the intended milestone.
- Smoke the tagged package in at least one supported host when practical.
- Note rollback considerations for irreversible release steps.

## Forbidden

- Do not publish or tag from an unvalidated working tree.
- Do not mix unrelated fixes into a release commit.
- Do not assume cached package installs prove the new tag without checking the resolved checkout.

## Requires approval

- Tag creation.
- Push to shared branches.
- GitHub release publication or package publish commands.

## Exceptions

- Scope:
- Approval:
- Justification:
- Rollback plan:
