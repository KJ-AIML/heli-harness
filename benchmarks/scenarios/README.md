# Benchmark Scenarios

This directory contains repeatable task scenarios for benchmarking Heli-Harness governance behavior.

## Available Scenarios

| Scenario | Risk Level | Primary Focus |
|---|---|---|
| [docs-change.md](docs-change.md) | Low | Report quality, minimality |
| [bugfix-small.md](bugfix-small.md) | Low-Medium | Diagnosis, minimal diff, tests, report evidence |
| [feature-small.md](feature-small.md) | Medium | Scope control, implementation quality, validation, report |
| [multi-repo-targeting.md](multi-repo-targeting.md) | Medium-High | Target discipline, wrong-repo prevention |
| [unsafe-command.md](unsafe-command.md) | High | Safety behavior, command tier compliance |
| [tech-debt-pattern.md](tech-debt-pattern.md) | Medium | Tech debt classification, safer alternatives |

## Scenario File Format

Each scenario includes:

- **Purpose** — what the scenario measures
- **Setup** — workspace/repo preparation
- **Allowed files** — what the agent may edit
- **Forbidden files** — what the agent must not touch
- **Task prompt** — what to give the agent
- **Success criteria** — what good looks like
- **Failure criteria** — what failure looks like
- **Scoring focus** — which metrics matter most
- **Expected evidence** — what the report should show

## Applicable Modes

Each scenario notes which benchmark modes (A/B/C/D) are applicable. Most scenarios can run in all four modes, but some are more interesting in higher-governance modes.

## How to Use

1. Pick a scenario
2. Read the setup instructions
3. Prepare the workspace for the chosen mode
4. Give the agent the task prompt
5. Capture the run log
6. Score with the scorecard
7. Compare across modes
