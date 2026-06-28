# Contributing to Heli-Harness

Thanks for your interest in contributing!

## Development workflow

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Test locally (see below)
5. Submit a pull request

## Testing locally

Before submitting a PR, validate your changes:

```bash
# JSON parse checks
python -c "import json; json.load(open('package.json'))"
python -c "import json; json.load(open('manifest.json'))"
python -c "import json; json.load(open('.heli-harness/manifest.json'))"

# YAML frontmatter validation
python -c "
import yaml, os
for skill in os.listdir('.heli-harness/skills'):
    path = f'.heli-harness/skills/{skill}/SKILL.md'
    if os.path.exists(path):
        with open(path) as f:
            content = f.read()
        if content.startswith('---'):
            parts = content.split('---', 2)
            if len(parts) >= 3:
                yaml.safe_load(parts[1])
"

# Shell script syntax
bash -n install.sh
bash -n update.sh
bash -n uninstall.sh

# PowerShell syntax (Windows)
powershell -NoProfile -Command "try { \$null = [System.Management.Automation.PSParser]::Tokenize((Get-Content install.ps1 -Raw), [ref]\$null); Write-Host 'install.ps1: OK' } catch { Write-Host 'install.ps1: FAIL' }"

# JavaScript syntax
node --check extensions/pi-extension.js

# Test install in a clean folder
mkdir /tmp/test-install
./install.sh /tmp/test-install
ls /tmp/test-install/.heli-harness
```

## Adding a new skill

1. Create `.heli-harness/skills/<skill-name>/SKILL.md`
2. Add YAML frontmatter:

   ```yaml
   ---
   name: <skill-name>
   description: "Short description of what this skill does."
   ---
   ```

3. Write the skill content in markdown
4. Update `.heli-harness/manifest.json` to include the skill in the `skills` array
5. Test that the skill loads correctly

## Adding a new adapter

1. Create `.heli-harness/adapters/<adapter-name>/`
2. Add adapter-specific instructions (e.g., `AGENTS.md`, `CLAUDE.md`, etc.)
3. Update `.heli-harness/manifest.json` to include the adapter in the `adapters` array
4. Update `README.md` to document the new adapter
5. Test that the adapter works with the target agent

## Code style

- Use consistent naming (heli-harness, not heli-harness)
- Keep scripts simple and deterministic
- No auto-install or destructive operations without confirmation
- Preserve user data (profiles, state) during updates

## Pull request checklist

- [ ] All validation checks pass
- [ ] Tested install/update/uninstall locally
- [ ] Updated documentation if needed
- [ ] No legacy references (heli-harness)
- [ ] Commit messages are clear and descriptive

## Questions?

Open an issue on GitHub: <https://github.com/KJ-AIML/heli-harness/issues>
