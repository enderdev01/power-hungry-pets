# Power Hungry Pets — Digital Adaptation Specs

This directory is the implementation specification for the project.

## Start here

Agents must read:

1. [`00_AGENT_BRIEF.md`](./00_AGENT_BRIEF.md)
2. [`01_PRODUCT_SCOPE.md`](./01_PRODUCT_SCOPE.md)
3. [`02_GAME_RULES.md`](./02_GAME_RULES.md)
4. [`03_CARD_CATALOG.md`](./03_CARD_CATALOG.md)
5. the technical document relevant to the assigned task
6. [`09_OPEN_QUESTIONS.md`](./09_OPEN_QUESTIONS.md)

## Documents

| File | Purpose |
|---|---|
| `00_AGENT_BRIEF.md` | Agent instructions and source-of-truth hierarchy |
| `01_PRODUCT_SCOPE.md` | Product boundaries and MVP |
| `02_GAME_RULES.md` | Canonical gameplay rules |
| `03_CARD_CATALOG.md` | Exact card quantities, effects and interactions |
| `04_GAME_ENGINE_SPEC.md` | Pure TypeScript engine architecture |
| `05_MULTIPLAYER_ARCHITECTURE.md` | Server-authoritative online design |
| `06_UI_UX_SPEC.md` | Game-table behavior and animation requirements |
| `07_TEST_PLAN.md` | Required rule and security tests |
| `08_IMPLEMENTATION_PLAN.md` | Milestones and recommended task order |
| `09_OPEN_QUESTIONS.md` | Ambiguities and project decisions |

## Important

A prompt given to an implementation agent should be short.

Example:

```text
Implement Milestone 1 from docs/08_IMPLEMENTATION_PLAN.md.

Treat docs/ as the source of truth.
Read docs/00_AGENT_BRIEF.md first.
Do not implement later milestones.
Run the relevant tests and report any spec ambiguity instead of inventing rules.
```

The detailed rules should live in these documents, not in giant prompts.
