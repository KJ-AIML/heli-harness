# Contributing to Heli-Harness

Thanks for your interest in contributing!

## Development workflow

1. Fork the repository.
2. Create a feature branch.
3. Make the smallest relevant change.
4. Run the validation below.
5. Submit a pull request.

## Validation

Run the full repository validation before submitting a pull request:

```bash
npm run check
```

This is the canonical check and requires Node.js with npm. It includes syntax checks, smoke tests, adapter verification, and release-document validation.

Optional checks are for the environments they exercise:

- Run `bash -n install.sh update.sh uninstall.sh` when changing shell scripts; it requires Bash.
- Run the PowerShell parser check when changing `.ps1` scripts; it requires PowerShell.
- Run `npm run live-verify:<adapter>` only for maintainer release proof. These commands require the named host CLI and credentials, and may make API calls or consume provider usage.

## Adding a new skill

1. Create `.heli-harness/skills/<skill-name>/SKILL.md`.
2. Add YAML frontmatter:

   ```yaml
   ---
   name: <skill-name>
   description: "Short description of what this skill does."
   ---
   ```

3. Write the skill content in Markdown.
4. Update `.heli-harness/manifest.json` to include the skill in the `skills` array.
5. Run `npm run check`.

## Adding a new adapter

1. Create `.heli-harness/adapters/<adapter-name>/`.
2. Add adapter-specific instructions (for example, `AGENTS.md` or `CLAUDE.md`).
3. Update `.heli-harness/manifest.json` to include the adapter in the `adapters` array.
4. Update `README.md` and `docs/ADAPTER_SUPPORT_MATRIX.md` with evidence-backed status and limits.
5. Run `npm run check`.

## Code style

- Use the project name consistently: Heli-Harness.
- Keep scripts simple and deterministic.
- Do not auto-install or run destructive operations without confirmation.
- Preserve user data (profiles and state) during updates.

## Pull request checklist

- [ ] `npm run check` passes.
- [ ] Relevant install, update, or uninstall behavior was tested when changed.
- [ ] Documentation and adapter evidence were updated when needed.
- [ ] No stale project-name references remain.
- [ ] Commit messages are clear and descriptive.

## Questions?

Open an issue on GitHub: <https://github.com/KJ-AIML/heli-harness/issues>
