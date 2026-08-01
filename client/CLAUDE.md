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

## Use when

- Page/route map, commands → read `README.md`
- Deep-dives → read `docs/` · UI/flow specs → read `specs/` ·
  findings → read `INSIGHTS.md`
- Endpoint shapes → read `../server/README.md`
