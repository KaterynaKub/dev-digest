/** Onion-architecture guard for server/.
 *
 * Rule severities follow the allowed-import matrix in
 * .claude/skills/onion-architecture/rules/dependency-rule.md.
 *
 * `warn` marks a rule the codebase does not satisfy yet. Those are pre-existing
 * violations, tracked below — they must not grow, and each should become
 * `error` once the listed files are refactored. Everything already clean is
 * `error` from day one so it cannot regress.
 *
 * Known outstanding (warn):
 *   routes-no-persistence      — pulls + settings routes query Drizzle directly
 *                                instead of going through a repository.
 *   helpers-are-pure           — repos/helpers.ts imports db/schema.
 *   service-no-concrete-adapters — repo-intel/service.ts imports astgrep and
 *                                codeindex adapters directly.
 *   no-circular                — one genuine agents/helpers.ts ↔ repository.ts
 *                                type cycle.
 *
 * Cleared (now `error`, do not regress):
 *   service-no-container       — every service takes explicit ports (a `*Deps`
 *                                interface) instead of the composition root.
 *                                Container is built only in routes/app.ts, via
 *                                the `reviewDeps`/`repoIntelDeps` factories.
 *   service-no-sql             — services receive their repository as a port, so
 *                                no service imports db/client, db/schema, or
 *                                db/rows. Row types are re-exported by the
 *                                repository that owns them.
 *
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  options: {
    tsPreCompilationDeps: true, // see `import type` too
    tsConfig: { fileName: './tsconfig.json' },
    doNotFollow: { path: 'node_modules' },
    // server/clones/ holds third-party checkouts — never scan them.
    exclude: { path: '^(src/clones|clones|dist|node_modules)/' },
    reporterOptions: { text: { highlightFocused: true } },
  },
  forbidden: [
    // ---------- structural ----------
    {
      name: 'no-circular',
      severity: 'warn', // existing cycles all pass through platform/container.ts
      comment: 'Cycles make layering unprovable.',
      from: {},
      to: { circular: true },
    },

    // ---------- layer 1: domain model ----------
    {
      name: 'contracts-are-pure',
      severity: 'error',
      comment: 'Domain model may depend on zod and sibling contracts only.',
      from: { path: '^src/vendor/shared/contracts/' },
      to: {
        pathNot: '^src/vendor/shared/(contracts|index)|^node_modules/zod',
        dependencyTypesNot: ['core'],
      },
    },

    // ---------- layer 3: ports ----------
    {
      name: 'ports-know-no-adapters',
      severity: 'error',
      comment: 'A port must not reference an implementation.',
      from: { path: '^src/vendor/shared/adapters\\.ts$' },
      to: { path: '^src/(adapters|db|modules)/' },
    },

    // ---------- layer 4: application services ----------
    {
      name: 'service-no-sql',
      severity: 'error',
      comment: 'Application layer must not touch persistence. Use the repository.',
      from: { path: '^src/modules/[^/]+/(service|run-executor)\\.ts$' },
      to: { path: '^src/db/|^node_modules/(drizzle-orm|postgres)/' },
    },
    {
      name: 'service-no-http',
      severity: 'error',
      comment: 'Application layer must not know about HTTP. Throw platform errors.',
      from: { path: '^src/modules/[^/]+/(service|run-executor)\\.ts$' },
      to: { path: '^node_modules/(fastify|@fastify)/' },
    },
    {
      name: 'service-no-concrete-adapters',
      severity: 'warn', // repo-intel/service.ts imports astgrep + codeindex
      comment: 'Inject ports from @devdigest/shared; never import an adapter.',
      from: { path: '^src/modules/[^/]+/(service|run-executor)\\.ts$' },
      to: { path: '^src/adapters/' },
    },
    {
      name: 'service-no-container',
      severity: 'error',
      comment: 'Services take explicit ports, not the composition root.',
      from: { path: '^src/modules/[^/]+/(service|run-executor)\\.ts$' },
      to: { path: '^src/platform/container\\.ts$' },
    },

    // ---------- layer 5: routes ----------
    {
      name: 'routes-no-persistence',
      severity: 'warn', // pulls + settings routes still query Drizzle directly
      comment: 'Routes call services; they never reach the DB.',
      from: { path: '^src/modules/[^/]+/routes\\.ts$' },
      to: {
        path: '^src/db/|^node_modules/(drizzle-orm|postgres)/|^src/modules/[^/]+/repository',
      },
    },

    // ---------- layer 2: helpers must stay pure ----------
    {
      name: 'helpers-are-pure',
      severity: 'warn', // repos/helpers.ts imports db/schema
      comment: 'helpers.ts is pure domain logic — no I/O, no outward imports.',
      from: { path: '^src/modules/[^/]+/helpers\\.ts$' },
      to: {
        path: '^src/(db|adapters)/|^src/platform/container\\.ts$|^node_modules/(fastify|drizzle-orm|postgres|octokit|simple-git)/',
      },
    },

    // ---------- cross-module ----------
    {
      name: 'no-cross-module-service',
      severity: 'error',
      comment: 'Modules share repositories, constants and ports — never services.',
      from: { path: '^src/modules/([^/]+)/' },
      to: {
        path: '^src/modules/([^/]+)/(service|routes)\\.ts$',
        pathNot: '^src/modules/$1/',
      },
    },

    // ---------- infrastructure ----------
    {
      name: 'adapters-know-no-modules',
      severity: 'error',
      comment:
        'Adapters implement ports; they must not reach into feature logic. ' +
        "A module's constants.ts is exempt — literals carry no behaviour, and " +
        'astgrep/depgraph legitimately share repo-intel tuning constants.',
      from: { path: '^src/adapters/' },
      to: { path: '^src/modules/', pathNot: '^src/modules/[^/]+/constants\\.ts$' },
    },
    {
      name: 'db-knows-no-modules',
      severity: 'error',
      comment: 'Schema is infrastructure; it must not depend on features.',
      from: { path: '^src/db/' },
      to: { path: '^src/modules/|^src/adapters/' },
    },
  ],
};
