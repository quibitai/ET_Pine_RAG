/** @type {import('next').NextConfig} */
const nextConfig = {
  // Runtime configuration
  reactStrictMode: true,
  
  // Build configuration
  output: 'standalone',
  typescript: {
    ignoreBuildErrors: true, // Temporarily allow build with TypeScript errors
  },

  // Asset optimization
  optimizeFonts: true,
  poweredByHeader: false,
  
  experimental: {
    // Improved production debugging
    logging: {
      level: 'verbose', // Set to 'verbose' to see detailed build logs
    },
    
    instrumentationHook: true,
    
    // Module resolution
    typedRoutes: true,
    
    // Performance improvements
    optimizePackageImports: ['@/components'],
    
    // Safety features
    serverComponentsExternalPackages: [],
  },
}

module.exports = nextConfig 