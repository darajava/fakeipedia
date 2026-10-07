import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["geoip-country"],
  async redirects() {
    return [{
      source: "/w/:wiki/:path*",
      destination: "/:wiki/:path*",
      permanent: true,
    }];
  },
};

export default nextConfig;
