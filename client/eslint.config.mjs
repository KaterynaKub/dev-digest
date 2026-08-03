import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "next-env.d.ts",
      // Vendored copies of @devdigest/shared and @devdigest/ui — owned upstream.
      "src/vendor/**",
    ],
  },

  ...compat.extends("next/core-web-vitals", "next/typescript"),

  {
    rules: {
      // --- ui-frontend-architecture: layer boundaries -------------------
      // app/ → components/, lib/  ·  components/, lib/ never import from app/.
      // Deep relative climbs (../../../..) defeat the boundary by hiding it,
      // so route code must reach shared layers through the @/ alias.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/../../../*"],
              message:
                "Deep relative import — use the '@/' alias (@/lib, @/components) instead.",
            },
            {
              group: ["@/app/*", "**/app/**"],
              message:
                "Route code must not be imported outside app/ — move the shared part to components/ or lib/.",
            },
          ],
        },
      ],

      // --- react-best-practices ----------------------------------------
      // Effect dependency correctness is a warning, not an error: the codebase
      // has pre-existing intentional omissions. Warn keeps them visible without
      // failing the build on day one.
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  {
    // Tests reach into fixtures and messages/ by relative path by design.
    files: ["**/*.test.ts", "**/*.test.tsx", "src/test/**"],
    rules: { "no-restricted-imports": "off" },
  },
];

export default eslintConfig;
