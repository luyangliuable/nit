/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The pi SDK is a native Node package. Keep it external to the bundler so it
  // runs in the custom server process, not inside webpack.
  experimental: {
    serverComponentsExternalPackages: ["@mariozechner/pi-coding-agent"],
  },
};

export default nextConfig;
