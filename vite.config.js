import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  base: './',
  // host 绑 0.0.0.0 + allowedHosts 放行：本地预览与云端反代域名访问都需要，
  // 否则 Vite 会以 "Blocked request. This host is not allowed." 拒绝请求。
  server: { host: '0.0.0.0', port: 5173, allowedHosts: true },
  preview: { host: '0.0.0.0', port: 4173, allowedHosts: true }
})
