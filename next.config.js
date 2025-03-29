/** @type {import('next').NextConfig} */
const nextConfig = {
  // Runtime configuration
  reactStrictMode: true,
  
  // Build configuration
  output: 'standalone',
  typescript: {
    // ignoreBuildErrors: true, // Set to false or remove
    ignoreBuildErrors: false,
  },

  // Disable header
  poweredByHeader: false,
  
  experimental: {
    // Module resolution
    typedRoutes: true,
    
    // Performance improvements
    // optimizePackageImports: ['@/components'], // Comment out or remove
  },
}

module.exports = nextConfig 