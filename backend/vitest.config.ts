// vitest.config.ts —— 测试框架配置
//
// 为什么独立 vitest 配置：
//   vitest 与 tsconfig 共享 tsconfig.json 编译选项，
//   但 tsconfig 的 rootDir=src 不覆盖 __tests__ 子目录，
//   这里手动 include 所有 __tests__ 目录。
//
// 运行：
//   pnpm test            单次跑完
//   pnpm test -- --watch 监听模式
//   DEBUG=app:* pnpm test 测试期间同时打开 debug 日志
import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ESM 下没有 __dirname，用 import.meta.url 派生
const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    // 匹配所有 __tests__/*.test.ts 和 *.spec.ts
    include: ['src/**/__tests__/**/*.test.ts'],

    // 与 tsconfig.json 的 module=NodeNext 对齐
    environment: 'node',

    // 测试超时：3 秒足够（纯函数），网络调用的测试单独设
    testTimeout: 3000,

    // 覆盖率（后续按需加 @vitest/coverage-v8）
    coverage: {
      reporter: ['text', 'html'],
      exclude: ['**/__tests__/**', '**/node_modules/**', 'dist/**'],
    },
  },

  // 路径别名：@ → src（与 vite.config.ts 保持一致）
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
})
