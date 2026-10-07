declare module "geoip-country" {
  const geoip: {
    lookup(ip: string): { country: string } | null;
  };
  export default geoip;
}
