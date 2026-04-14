const { withSentryConfig } = require('@sentry/nextjs');

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@repo/ui", "@repo/supabase"],
  experimental: {
    // @react-pdf/renderer pulls in native deps (fontkit, pdfkit, linebreak) that
    // webpack cannot statically bundle for Vercel serverless functions — they rely
    // on dynamic require() of font files and binary resources. Listing it here
    // keeps it as a Node.js external at runtime so renderToBuffer() works in
    // API routes like /api/projects/[id]/survey, /api/projects/[id]/qc/[id],
    // /api/projects/[id]/dc/[id], /api/projects/[id]/commissioning,
    // /api/procurement/[poId]/pdf. Without this, every server-side PDF render
    // fails silently on Vercel with an opaque 500.
    serverComponentsExternalPackages: ['@react-pdf/renderer'],
  },
};

module.exports = withSentryConfig(nextConfig, {
  // Sentry webpack plugin options
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
}, {
  // Sentry SDK options
  widenClientFileUpload: true,
  tunnelRoute: '/monitoring',
  hideSourceMaps: true,
  disableLogger: true,
});
