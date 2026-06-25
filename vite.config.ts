import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
// import vueDevTools from 'vite-plugin-vue-devtools';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue()
    // vueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  build: {
    // Tauri WebView2 (Chromium) 已是现代浏览器，指定高 target 避免不必要转译
    target: 'chrome110',
    // base.ts 单文件 ~375KB，避免触发 chunk 大小警告噪音
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          // Vue 运行时 + 虚拟滚动组件（体积稳定，单独分包利于长期缓存）
          vendor: ['vue', 'vue-virtual-scroller'],
          // protobuf 共享基础类型（~375KB），各 message decoder 文件都依赖，
          // 强制单 chunk 避免被不同 dynamic import 子图重复内联
          'protobuf-base': ['./src/core/model/base.ts', './src/core/model/shared.ts']
        }
      }
    }
  },
  server: {
    host: '0.0.0.0', // 允许局域网访问
    port: 5173,
    strictPort: true, // Tauri 需要固定端口
    proxy: {
      '/dylive': {
        target: 'https://live.douyin.com',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/dylive/, ''),
        // 重要：允许接收 Set-Cookie
        configure: proxy => {
          // 拦截请求
          proxy.on('proxyReq', (proxyReq, req) => {
            const ua = req.headers['user-agent'] || '';
            const isMobile = /mobile|android|iphone|ipad/i.test(ua);
            if (isMobile) {
              // 设置请求头 User-Agent 标识
              // 防止移动端 302 重定向跳转
              // 可根据自己的平台设置
              proxyReq.setHeader(
                'User-Agent',
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0'
              );
            }
            // 强制修改 Referer(这里可能无效，但并不影响)
            proxyReq.setHeader('Referer', 'https://live.douyin.com/');
          });
          // 拦截响应
          proxy.on('proxyRes', proxyRes => {
            // 确保 set-cookie 能正常设置到当前域下
            const setCookie = proxyRes.headers['set-cookie'];
            if (setCookie) {
              // 移除 Domain 或替换为当前域
              const newCookie = setCookie.map(cookie =>
                cookie
                  .replace(/; Domain=[^;]+/i, '')
                  .replace(/; SameSite=None/, '')
                  .replace(/; Secure=true/i, '')
              );
              proxyRes.headers['set-cookie'] = newCookie;
            }
          });
        }
      },
      '/socket': {
        // target: 'wss://webcast5-ws-web-lf.douyin.com',
        target: 'wss://webcast100-ws-web-lq.douyin.com',
        changeOrigin: true, // 保持原始 Host，利于服务端识别 Cookie
        secure: true,
        ws: true, // 启用 WebSocket 代理
        rewrite: path => path.replace(/^\/socket/, ''),
        configure: proxy => {
          proxy.on('proxyReqWs', (proxyReq, req) => {
            const ua = req.headers['user-agent'] || '';
            const isMobile = /mobile|android|iphone|ipad/i.test(ua);
            // 这里可以不设置也
            if (isMobile) {
              // 设置请求头 User-Agent 标识
              proxyReq.setHeader(
                'User-Agent',
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0'
              );
            }
          });
        }
      }
    }
  }
});
