/** Domain-purity guard for reviewer-core/ — the strictest config in the repo.
 *
 * The core is layer 2: pure review logic. Side effects arrive only through the
 * injected LLMProvider port. Every rule here is `error` — the package is
 * currently clean (deps: openai, zod) and must stay that way.
 *
 * See .claude/skills/onion-architecture/rules/domain-purity.md.
 *
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: './tsconfig.json' },
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '^(dist|node_modules)/' },
  },
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Cycles make layering unprovable.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'core-stays-pure',
      severity: 'error',
      comment: 'The core has no DB, no HTTP, no filesystem, and no server import.',
      from: { path: '^src/' },
      to: {
        // `@devdigest/shared` resolves to ../server/src/vendor/shared/** — those
        // are the layer-1 contracts the core is *allowed* to depend on, so the
        // server exclusion must skip them (pathNot) rather than ban the whole
        // ../server/ prefix.
        path: '^node_modules/(drizzle-orm|postgres|fastify|@fastify|octokit|simple-git)/|^\\.\\./server/',
        pathNot: '^\\.\\./server/src/vendor/shared/',
      },
    },
    {
      name: 'core-no-node-io',
      severity: 'error',
      comment: 'Side effects arrive through the injected LLMProvider only.',
      from: { path: '^src/' },
      to: { dependencyTypes: ['core'], path: '^(fs|child_process|net|http|https)$' },
    },
  ],
};
