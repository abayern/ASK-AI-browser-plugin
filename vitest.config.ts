import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 核心逻辑刻意不依赖浏览器环境，因此使用 node 环境运行，
    // 这样测试更快，也证明业务层没有偷偷依赖 DOM。
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    clearMocks: true,
  },
});
