# Agent Governance Research Synthesis

## Why This Research Was Done

Heli-Harness needs a durable roadmap after v0.3.2. The goal of this research synthesis is to record what current coding-agent systems suggest about governance, instructions, hooks, memory, skills, permissions, reports, and repo identity.

This document is intentionally conservative. It does not claim that Heli should copy any one product. It extracts patterns that support Heli's role as a local, markdown-first governance harness.

## Key Lessons from Codex

Codex emphasizes layered durable guidance through `AGENTS.md`, with global and project instructions loaded before work starts. OpenAI's Codex documentation also presents customization as complementary layers: project guidance, memories, skills, MCP, and subagents each serve different roles.

Lessons for Heli:

- Durable instructions are useful when they travel with the repo.
- Instructions should be layered and scoped.
- Skills are best treated as reusable workflows, not as hidden policy.
- Subagents and orchestration are separate runtime concerns; Heli should not implement them.
- Repo guidance should pair with enforcement such as linters, tests, hooks, and approvals.

Evidence strength:
Strong for Codex instruction layering and skills, because it is documented in official OpenAI docs.

## Key Lessons from Claude Code

Claude Code separates memory, hooks, permissions, skills, settings, and subagents. Its docs explicitly distinguish memory and instructions from enforcement: remembered context is loaded into the conversation, while hooks and permissions are the mechanism for blocking or approving actions.

Lessons for Heli:

- Instructions and memory are context, not enforcement.
- Hook systems need strong safety warnings because they can run with user permissions.
- Permission and hook decisions should be explicit and observable.
- Skills package repeatable workflows, but should not replace repo policy.
- Multi-agent features belong to the host runtime, not to Heli.

Evidence strength:
Strong for the distinction between context and enforcement, because it is documented in official Anthropic docs.

## Key Lessons from Roo Code

Roo Code presents a model with file access, terminal control, tool use, modes, and user approval/rejection flows. Public documentation emphasizes prompt discipline, custom instructions, and careful handling of tool actions.

Lessons for Heli:

- Terminal and file-system access make safety rules necessary.
- Human approval and rejection are part of the governance loop.
- More context can improve outcomes, but it does not replace explicit policy and guardrails.
- Host-specific tool behavior should be adapted to, not absorbed into Heli core.

Evidence strength:
Moderate. Roo's public docs describe capabilities and workflows, but Heli should avoid assuming internal enforcement details not documented publicly.

## Key Lessons from Continue

Continue exposes context providers, rules, model configuration, and MCP integration. Its docs show a layered approach to providing context and tools to coding agents.

Lessons for Heli:

- Context should be selectable and scoped.
- Rules and tools should be configured separately.
- MCP and external tools are integrations, not governance policy by themselves.
- Heli should remain adapter-friendly so hosts like Continue can consume the same repo facts and policies in their own way.

Evidence strength:
Moderate to strong for context providers, rules, and MCP concepts because they are documented in official Continue docs.

## Key Lessons from Aider

Aider has long emphasized repository-aware editing, compact context, git-based workflows, and human review through diffs and commits.

Lessons for Heli:

- Git is the durable audit substrate for code changes.
- Reports and commits should be reviewable artifacts.
- Context should be relevant and compact.
- Heli should not replace git history or code review; it should improve the discipline around them.

Evidence strength:
Moderate. Aider's public documentation and community practice support these patterns, but this synthesis avoids detailed claims about internal behavior.

## Key Lessons from Cursor and Windsurf Research Signal

Cursor and Windsurf signal that modern coding-agent environments are moving toward persistent rules, workspace memory, context selection, and IDE-integrated agent workflows. Windsurf documentation describes memories and rules as separate mechanisms, with memories generated automatically and rules defined by users.

Lessons for Heli:

- Memory can help recall context, but required policy should not live only in memory.
- Rules should remain inspectable and reviewable.
- Workspace-level context matters.
- Heli should keep local files as the source of durable governance rather than relying on IDE-specific memory.

Evidence strength:
Weak to moderate for Cursor because public details vary by product surface. Stronger for Windsurf memories/rules where official docs are available. Treat both as directionally useful signals, not as exact models to copy.

## Key Lessons from GitHub Copilot Coding-Agent Workflow Signal

GitHub Copilot's coding-agent docs emphasize repository custom instructions, `AGENTS.md`, build/test guidance, and pull requests as review artifacts. The nearest instruction file can take precedence for agent work, and GitHub recommends repository instructions that explain how to build, test, and validate changes.

Lessons for Heli:

- Repo instructions should be committed and reviewable.
- Build, test, and validation expectations should be explicit.
- Agent output should become a pull request or review artifact.
- Nested or scoped instructions need clear precedence rules.

Evidence strength:
Strong for repository custom instructions and PR workflow, because these are official GitHub docs.

## What Heli Should Adopt

- Separation of concerns across facts, policies, safety, state, adapters, hooks, and reports.
- Observable hooks through startup signals, inspection commands, one-shot canaries, and reportable safety events.
- Repo profiles that describe facts and classify existing patterns.
- Policy overlays that state required, recommended, forbidden, approval-gated, and exception-based behavior.
- Safety overlays that can be enforced by hooks and host permissions where available.
- Reports as review artifacts.
- Explicit multi-repo identity and target selection.
- Lightweight machine-readable sidecars only where validation or enforcement needs structure.

## What Heli Should Avoid

- Becoming a full agent runtime.
- Becoming a planner.
- Becoming a task execution engine.
- Becoming a multi-agent orchestrator.
- Using memory as the source of required policy.
- Building a vector memory platform.
- Adding central database storage.
- Launching a plugin marketplace before schemas stabilize.
- Treating every observed repo pattern as a recommended convention.
- Hiding important governance state outside reviewable files.

## Evidence Classes for Heli

This synthesis separates four evidence classes:

- Hypothesis: expected governance outcomes that still need measured runs.
- Design rationale: product decisions inferred from documented agent-system patterns.
- Observed evidence: behavior visible in local smoke tests, docs, or repo artifacts.
- Measured benchmark results: scored benchmark runs captured with run logs and scorecards.

Heli does not yet ship measured benchmark matrix results. The benchmark pack defines methodology, rubrics, templates, and illustrative examples; measured runs are planned in v0.5.x Full Coverage work.

## How the OpenMesh Benchmark Method Maps to Research Findings

The OpenMesh-style example is an illustrative / hypothetical benchmark design, not a measured benchmark result. It shows how to compare agent behavior across governance conditions:

- no harness
- Heli with descriptive profile
- Heli with stronger prescriptive policy overlay

Hypotheses to test:

- Heli should improve workflow discipline, traceability, reports, and pre-work audit behavior.
- Auto-generated descriptive profiles should improve awareness but may not reliably stop agents from copying weak existing patterns.
- Prescriptive engineering directives and policy overlays should produce stronger implementation quality.
- Therefore, Heli needs policy overlays and tech-debt classification.

Mapping to research:

- Codex and GitHub Copilot support durable repo instructions as useful context.
- Claude Code supports the conclusion that context is not enforcement; hooks and permissions are needed for blocking.
- Continue and Windsurf support separating rules from other context or memory.
- Roo Code and Aider reinforce that tool actions, diffs, and human review remain important governance boundaries.

## Research-Backed Design Decisions

- Separation of concerns matters more than simply adding more context.
- Hooks must be observable.
- Instructions are context; guards and permissions enforce.
- Auto-generated profiles need taxonomy.
- Memory must not become the source of required policy.
- Reports should be review artifacts.
- Multi-repo identity must be explicit.
- Evaluation should measure governance, not only implementation success.

## Uncertainties and Weak Evidence Areas

- Pi and AXGA are validated through local smoke tests and package behavior, but their public documentation surface is smaller than the larger vendors.
- Ponytail is useful as an observability comparison, but Heli should not copy its entire mode model.
- Cursor and Windsurf product behavior may change quickly; treat them as directional signals.
- Benchmark scoring needs calibration across models and host tools.
- Policy linting must avoid false confidence from overly simple rules.

## Sources / References

- OpenAI Codex AGENTS.md guidance: <https://developers.openai.com/codex/guides/agents-md>
- OpenAI Codex customization concepts: <https://developers.openai.com/codex/concepts/customization>
- OpenAI Codex skills: <https://developers.openai.com/codex/skills>
- OpenAI Codex subagents: <https://developers.openai.com/codex/subagents>
- Anthropic Claude Code memory: <https://docs.anthropic.com/en/docs/claude-code/memory>
- Anthropic Claude Code hooks: <https://docs.anthropic.com/en/docs/claude-code/hooks>
- Anthropic Claude Code hooks guide: <https://docs.anthropic.com/en/docs/claude-code/hooks-guide>
- Anthropic Claude Code settings: <https://docs.anthropic.com/en/docs/claude-code/settings>
- GitHub Copilot repository custom instructions: <https://docs.github.com/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot>
- GitHub Copilot coding-agent best practices: <https://docs.github.com/copilot/how-tos/agents/copilot-coding-agent/best-practices-for-using-copilot-to-work-on-tasks>
- Continue context providers: <https://docs.continue.dev/customize/deep-dives/custom-providers>
- Continue rules and codebase awareness: <https://docs.continue.dev/guides/codebase-documentation-awareness>
- Continue MCP tools: <https://docs.continue.dev/customize/mcp-tools>
- Roo Code docs: <https://docs.roocode.com/>
- Roo Code prompt engineering: <https://docs.roocode.com/advanced-usage/prompt-engineering>
- Windsurf memories and rules: <https://docs.windsurf.com/windsurf/cascade/memories>
- Windsurf Cascade overview: <https://docs.windsurf.com/windsurf/cascade>
