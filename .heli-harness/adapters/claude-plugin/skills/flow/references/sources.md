# Sources - flow

## Why structured choice beats free text

The user's complaint that motivated this skill: typing out intent every time is friction. A short menu beats an open-ended paragraph when the real need is routing.

### Supporting research

- **Hick's Law (Hick 1952, Hyman 1953)** - decision time scales with `log2(n+1)` where n is the number of equally probable options. Four concrete choices are faster than one unbounded text field.
  https://en.wikipedia.org/wiki/Hick%27s_law

- **Jakob Nielsen, "The Magical Number 7"** - for menu design, 4-7 options is a practical upper range. flow keeps each question small.
  https://www.nngroup.com/articles/the-magical-number-seven-plus-or-minus-two/

- **Don Norman, "The Design of Everyday Things"** - affordances and signifiers. A choice labeled "Fix something" is easier to act on than "describe your intent." Same idea applied to LLM UI.

### Plain-text menu rule

Many local coding agents do not have a structured question widget, so flow uses plain-text menus:
- Ask one question per turn.
- Keep choices distinct and mutually exclusive.
- Keep the menu small enough to fit on one screen.
- Always allow a free-form answer.
- Stop after asking; wait for the user's pick.

flow follows these constraints and then hands off to the target skill.

## Why a router skill instead of asking every specialist to ask

Two reasons:

1. **Specialists should not all start with "what flavor?"** That is a routing question, not a domain question. audit does not care whether the user wants to audit; it cares what code needs auditing. Keep routing in one place.

2. **Avoid making the user repeat themselves.** If the user goes to fix-loop directly and it turns out their fix is really a one-bug verify, fix-loop has to bail out and hand off. Better to route correctly the first time.

## Anti-pattern: wizard hell

A common failure mode of multi-step wizards is that they become the only interface, so users cannot skip them even when they know exactly what they want. flow explicitly prohibits this: clear requests skip the skill entirely. The skill fires only when intent is genuinely ambiguous.

The closest commercial analogue is the GitHub "new issue" template chooser: pick a template, or open a blank issue. flow's free-form escape hatch is the blank-issue option.

## Honest notes

- The top-level intents (Fix / Build / Verify / Write / Raise engineering quality) cover the user's documented workflow. Research, Refactor, and Explore stay in free-form fallback until usage proves they deserve first-class options.
- The skill now routes across the Heli-Harness: `engineering`, `verify-premise`, `feature`, `fix-loop`, `audit`, `branch`, and `gh-write`.
- If the family grows past 8-9 active routes, the Q2 trees will need restructuring.
