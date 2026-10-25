/** 运营后台（总方案 §11）：RBAC + TOTP 登录 + 参数中心 */
const nextConfig = {
  async rewrites() {
    return [{ source: '/api/:path*', destination: 'http://127.0.0.1:8080/admin/:path*' }]
  }
}
export default nextConfig
