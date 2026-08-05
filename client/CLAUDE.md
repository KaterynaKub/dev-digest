# client — `@devdigest/web`

Next.js 15 App Router studio. All data comes from the Fastify API; there is no
client-side DB access.

## Before answering

Search `docs/`, `specs/`, `INSIGHTS.md` first.

## Conventions (not obvious from code)

- Types/contracts come from `@devdigest/shared` (Zod) — never hand-duplicate them.
- All API access goes through `src/lib/api.ts`, reached via `src/lib/hooks/*`.
  Never call `fetch` from a component.
- Pages stay thin; feature logic lives in colocated `_components/<Name>/`
  shaped as `Name.tsx` · `constants.ts` · `styles.ts` · `index.ts` · `Name.test.tsx`.
- User-facing strings live in `messages/`, not inline in JSX.
- Every async action shows a loader — no exceptions, and no silent gaps. A
  triggering `Button` takes `loading={isPending}` (it swaps in a spinning
  `RefreshCw` on its own) plus a `…` label from `messages/`; slow content areas
  get `Skeleton` **with** a named `role="status"` line saying what is happening.
  Where a mutation is followed by `router.push`, hold the busy state past
  `onSuccess` until navigation lands — `isPending` alone flips back too early
  and the UI reads as frozen. `CreateSkillFromConventionsModal` is the reference.

## Use when

- Page/route map, commands → read `README.md`
- Deep-dives → read `docs/` · UI/flow specs → read `specs/` ·
  findings → read `INSIGHTS.md`
- Endpoint shapes → read `../server/README.md`
