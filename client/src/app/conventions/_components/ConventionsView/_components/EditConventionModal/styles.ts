import type { CSSProperties } from "react";

export const s = {
  body: { display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  footer: { display: "flex", justifyContent: "flex-end", gap: 10 } satisfies CSSProperties,
};

export const MODAL_WIDTH = 520;
