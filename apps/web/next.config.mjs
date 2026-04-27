/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@rummisphere/shared", "@rummisphere/game-engine"],
  reactCompiler: true,
};

export default nextConfig;
