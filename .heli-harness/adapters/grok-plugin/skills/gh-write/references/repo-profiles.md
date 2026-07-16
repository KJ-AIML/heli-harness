# Repo profiles — gh-write

Per-repo GitHub conventions. `gh-write` loads this file when it's about to write for a
repo, then applies the **first profile whose detection matches**. If none match, it falls back
to the generic profile (read `.github/PULL_REQUEST_TEMPLATE.md`, infer tone from the last merged PR).

**To onboard a new repo:** copy the template block below, fill it in, and drop it above the
generic fallback. Don't hardcode repo specifics back into `SKILL.md`.

Two rules apply to *every* profile and are NOT listed per-profile (they're the user's preference,
not the repo's): no `Co-Authored-By` tag, and no assistant/vendor mentions ("Claude", "Codex",
"AI", "Generated") anywhere in the body or commit messages.

---

## HQ Desktop

- **Detection:** working directory under `hq-inc/ProofOfConcept.2.Desktop` OR repo origin matches `iron-software/HQ.Desktop*`.
- **PR template:** **Why / Approach** sections (see `templates.md`).
- **Assignee:** self.
- **Request review from:** `@amagdum-iron`.
- **CI notes:** failures that are obviously API/quota issues — mention once, don't loop on them.

---

## Template — copy for a new repo

```
## <Repo name>

- **Detection:** <dir path under which this repo lives, OR origin glob, e.g. `org/Repo*`>
- **PR template:** <which template / sections — point at a block in templates.md>
- **Assignee:** <self / someone / none>
- **Request review from:** <@handle(s), or "none">
- **CI notes:** <anything repo-specific worth knowing; or omit>
```
