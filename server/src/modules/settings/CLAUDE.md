# modules/settings

Workspace settings: API keys, GitHub token, per-feature model choice.

## Before answering

Search `../../../docs/`, `../../../specs/`, `../../../INSIGHTS.md` first.

## Conventions (not obvious from code)

- Two stores behind one screen: non-secret settings go to the `settings` table;
  keys go to `~/.devdigest/secrets.json` via `SecretsProvider`. Never persist a
  key to the DB, never return one in a response.
- After writing a key, call `container.invalidateSecretCaches()` or cached
  clients keep the old value.
- Feature models resolve as workspace override → registry default; the defaults
  mirror each module's former hardcoded constant. Preserve that fallback.
- An invalid stored `feature_models` entry is treated as unset, not as an error.
- `GITHUB_TOKEN` is canonical; `GITHUB_PAT` is a fallback.

## Use when

- Where keys live → read the "Where keys live" note in `../../../README.md`
