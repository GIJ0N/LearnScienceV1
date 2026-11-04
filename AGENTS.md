# Development rules

- Active entry: `app_legacy.py`; persistence: `memory_store.py`. Keep `app.js` and the embedded JavaScript in parity.
- Inspect the current branch, worktrees and changes before editing. Preserve unrelated work and personal data.
- Use `docs/evidence_policy_v1.md`, active contracts and their tests for evidence rules. Design documents are not proof of implementation.
- Models propose content and evaluations; local contracts and policy decide admissibility. Unknown or invalid evaluations must not become positive evidence.
- Reading is exposure, not performance. Assistance is separate from correctness and independence. Immediate success is not delayed retention or transfer.
- Preserve attempt identity, idempotency, profile isolation, repair scope and return to the parent. Never invent legacy evidence.
- Test with synthetic profiles and SQLite outside the repository. Do not call paid providers or publish without authorization. Never output secrets.
- Run every command in `.github/workflows/ci.yml`, relevant regressions, parity and `git diff --check`. Distinguish controlled providers from real model acceptance and browser tests from function tests.
- Prefer bounded changes on the active path over framework migrations or activating disconnected modules. Preserve compatible data and document rollback limits.

The original extended guidance remains in `docs/AGENTS.md.md`.
