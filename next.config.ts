import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [{
      source: "/w/:wiki/:path*",
      destination: "/:wiki/:path*",
      permanent: true,
    }];
  },
};

export default nextConfig;
