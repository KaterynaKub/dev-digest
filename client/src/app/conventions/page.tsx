import { ConventionsView } from "./_components/ConventionsView";

/* Route: /conventions (Skills Lab → Conventions). Thin route entry — the view,
   its modals, styles, constants, helpers and i18n are colocated under
   _components/ConventionsView. The repo is resolved from the active-repo
   context rather than the path, since this route is not :repoId-scoped. */
export default function ConventionsPage() {
  return <ConventionsView />;
}
