@AGENTS.md

## Claude Code

- After any change, and before every commit, follow the **maintain-docs** skill (`.claude/skills/maintain-docs/SKILL.md`)
  so README.md, AGENTS.md, docs/TRACKER.md and docs/DECISIONS.md (plus the HLD decision log) stay current.
- The pre-commit hook runs `pnpm docs:check`; fix what it reports instead of bypassing it.
- Never push or create a remote without the user's explicit confirmation.
