# Cursor Install

From the parent workspace:

```powershell
Set-Content -Path .\.cursorrules -Value "Read .heli-harness/adapters/cursor/CURSOR.md first."
```

Or for scoped rules, create `.cursor/rules/harness.mdc`:

```markdown
---
description: Heli-Harness operating protocol
globs:
alwaysApply: true
---

Read .heli-harness/adapters/cursor/CURSOR.md first.
```

Do not copy Heli-Harness into Cursor's global settings by default. This harness is intended to live with the parent workspace.
