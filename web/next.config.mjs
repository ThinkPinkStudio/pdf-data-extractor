/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Next.js 14 uses experimental.serverComponentsExternalPackages
  experimental: {
    serverComponentsExternalPackages: ['pg', 'nodemailer'],
    instrumentationHook: true,
  },
}

export default nextConfig
