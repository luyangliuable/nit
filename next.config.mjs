/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle under .next/standalone. Electron ships
  // and spawns that bundle instead of running the tsx dev server.
  output: "standalone",
  // The pi SDK is a native Node package. Keep it external to the bundler so it
  // runs in the custom server process, not inside webpack.
  experimental: {
    serverComponentsExternalPackages: ["@mariozechner/pi-coding-agent"],
    // Run instrumentation.ts on server boot so pollers and the SSE hub resume
    // without the custom dev server (server.ts).
    instrumentationHook: true,
    // The pi SDK is loaded through a native dynamic import that the tracer
    // cannot see, so force its whole dependency closure into the standalone
    // bundle. Without this the packaged app would fail at first review.
    outputFileTracingIncludes: {
      "/**": [
        "./node_modules/@mariozechner/**",
        "./node_modules/@silvia-odwyer/**",
        "./node_modules/typebox/**",
        "./node_modules/undici/**",
      ],
    },
    // Never ship the developer's local state (sessions, clones, logs) inside
    // the standalone bundle. The packaged app writes to NIT_DATA_DIR instead.
    outputFileTracingExcludes: {
      "/**": ["./data/**", "./website/**", "./assets/**"],
    },
  },
};

export default nextConfig;
