/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Ensure data/catalog.json ships with the serverless functions on Vercel
    outputFileTracingIncludes: {
      "/api/process": ["./data/**"],
      "/api/leads": ["./data/**"]
    }
  }
};

export default nextConfig;
