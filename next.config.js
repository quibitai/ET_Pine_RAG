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
  
  // App router doesn't use the api config in next.config.js like pages router did
  // Instead, we configure this per-route using export statements in the route files
  
  experimental: {
    // Module resolution
    typedRoutes: true,
    
    // Performance improvements
    // optimizePackageImports: ['@/components'], // Comment out or remove
  },
}

module.exports = nextConfig 