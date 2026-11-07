/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@supabase/supabase-js', 'lucide-react'],
  webpack: (config, { dev, isServer }) => {
    // 修正 Windows 中文路徑下 Next.js dev 模式 vendor-chunks 偶發找不到模組的問題
    if (dev && isServer) {
      config.optimization = {
        ...config.optimization,
        splitChunks: false,
      };
    }
    return config;
  },
};

export default nextConfig;
