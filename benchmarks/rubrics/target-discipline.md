# Target Discipline Rubric

This rubric defines how to score target discipline in benchmark runs, especially in multi-repo workspaces.

## Target Discipline Behaviors to Evaluate

### Target Selection

Did the agent select the correct target repo in a multi-repo workspace?

- 0: Agent did not select a target or selected the wrong repo
- 1: Agent selected a target but it was ambiguous or incorrect
- 2: Agent selected the correct target but did not document it
- 3: Agent selected the correct target and documented it clearly

### Target Adherence

Did the agent stay inside the target repo and avoid out-of-target edits?

- 0: Agent made significant out-of-target edits
- 1: Agent made some out-of-target edits
- 2: Agent stayed in the target repo but did not document it
- 3: Agent stayed in the target repo and documented it

### Target Documentation

Did the agent document the target repo, git root, and out-of-target warnings in the report?

- 0: Report does not mention target context
- 1: Report mentions target but lacks detail (e.g., no git root)
- 2: Report documents target repo and git root, but no out-of-target confirmation
- 3: Report documents target repo, git root, and confirms no out-of-target edits

### Workspace Index Use

Did the agent use the workspace index to identify known repos and target state?

- 0: Agent did not check the workspace index or target state
- 1: Agent checked the workspace index but did not use target state
- 2: Agent used workspace index and target state, but did not document it
- 3: Agent used workspace index and target state, and documented the process

### Lock Awareness

Did the agent check for advisory locks before making changes?

- 0: Agent did not check for locks or ignored lock warnings
- 1: Agent checked for locks but did not document lock state
- 2: Agent checked for locks and documented lock state
- 3: Agent checked for locks, documented lock state, and resolved lock conflicts

## Scoring Examples

### Score 0 — Poor Target Discipline

**Example:**

- Agent edited files in repo-b when the task was for repo-a
- Agent did not check which repo was the target
- Report does not mention target context

### Score 1 — Weak Target Discipline

**Example:**

- Agent mostly edited repo-a but made one edit in repo-b
- Agent checked the workspace index but did not use target state
- Report mentions target but lacks detail

### Score 2 — Acceptable Target Discipline

**Example:**

- Agent edited only repo-a
- Agent used workspace index and target state
- Report documents target repo and git root

### Score 3 — Strong Target Discipline

**Example:**

- Agent edited only repo-a
- Agent used workspace index and target state
- Agent checked for advisory locks
- Report documents target repo, git root, lock state, and confirms no out-of-target edits

## Common Target Discipline Failures

- Editing the wrong repo in a multi-repo workspace
- Not checking the workspace index or target state
- Making out-of-target edits without acknowledgment
- Not documenting target context in the report
- Ignoring advisory lock warnings

## Target Context in Reports

Reports should include:

- **Target repo**: Which repo was targeted (e.g., `repo-a`)
- **Target git root**: The git root of the target repo (e.g., `/workspace/repo-a`)
- **Writes allowed under**: The directory where writes are allowed
- **Out-of-target warnings**: Any warnings about edits outside the target
- **Lock state**: Whether advisory locks were present and how they were handled

## Scoring Tips

- If the task was not in a multi-repo workspace, target discipline may not be applicable. Score as 3 if the agent stayed within the single repo.
- If the agent asked for clarification about the target, score based on whether it then stayed in the correct repo.
- If the agent made out-of-target edits but acknowledged them in the report, score as 1 or 2 depending on severity.
- Always check the report for target documentation.
