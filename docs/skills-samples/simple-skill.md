---
name: Changelog Discipline
description: Flags PRs that change externally-visible behaviour without a corresponding changelog entry.
type: convention
---

# Changelog Discipline

If the diff changes behaviour a consumer of this package could observe (a
public API response shape, a CLI flag, an exported function's signature), it
should come with a changelog entry. Silence on this is a WARNING, not a
CRITICAL — the fix is a follow-up comment, not a blocker.
