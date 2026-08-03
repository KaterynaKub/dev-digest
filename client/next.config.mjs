import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001",
  },
  webpack(config) {
    // src/vendor/shared is a copy of the server's contracts, which import each
    // other with explicit `.js` specifiers — mandatory there, since the server
    // is "type": "module" and ships as plain `node dist/server.js`.
    //
    // tsc resolves those to the .ts files (moduleResolution: Bundler) but
    // webpack does not, so importing a VALUE from @devdigest/shared (a Zod
    // schema, a constant) failed to build while `import type` kept working —
    // types are erased before webpack ever sees them.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default withNextIntl(nextConfig);
