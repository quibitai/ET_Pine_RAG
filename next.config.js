/** @type {import('next').NextConfig} */
const nextConfig = {
  // Runtime configuration
  reactStrictMode: true,
  
  // Build configuration
  output: 'standalone',
  typescript: {
    ignoreBuildErrors: true, // Temporarily allow build with TypeScript errors
  },

  // Disable header
  poweredByHeader: false,
  
  experimental: {
    // Module resolution
    typedRoutes: true,
    
    // Performance improvements
    optimizePackageImports: ['@/components'],
  },
}

module.exports = nextConfig 