# Smart Diff — demo fixture

Not production code. This folder exists only to give the Smart Diff feature a
pull request with a realistic shape:

- a large `core` file that crosses `LARGE_FILE_LINES_THRESHOLD` (300 lines),
- `wiring` files (config, barrel, routes),
- `boilerplate` files (a lockfile and a build artefact) that must sort last,
- deliberate defects at three severities so the finding badges have something
  to link to.

Delete the folder once the demo has served its purpose.
