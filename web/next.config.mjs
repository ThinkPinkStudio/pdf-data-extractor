/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Next.js 14 uses experimental.serverComponentsExternalPackages
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3', 'nodemailer'],
  },
}

export default nextConfig
