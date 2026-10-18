import { defineConfig } from 'wxt';

/**
 * WXT 构建配置。
 *
 * 权限说明（最小权限原则）：
 * - `storage`：保存配置与 API Key。
 * - `activeTab`：用户点击工具栏图标时，临时获得**当前标签页**的访问权，
 *   用于注入划词脚本。它不会在安装时授予任何站点访问权。
 * - `scripting`：执行上面这次注入。
 *
 * 明确不申请：
 * - `<all_urls>` 之类的宽泛主机权限：划词只在用户点击后于当前页生效；
 * - `tabs`：不需要读取标签页标题或地址。
 */
export default defineConfig({
  // 关闭自动导入：所有 API 显式 import，便于审查与类型推断。
  imports: false,
  modules: ['@wxt-dev/module-react'],
  // 三个目标浏览器统一使用 MV3。
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    name: '划词问 AI',
    description: '划词选中网页文字，向你自己配置的 AI 服务商提问。API Key 只保存在本地。',
    permissions: ['storage', 'scripting', 'activeTab'],
    action: {
      default_title: '划词问 AI',
    },
    // Firefox 需要固定扩展 id 才能在开发模式下保留 storage 数据。
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'ask-ai-browser-plugin@local',
              strict_min_version: '115.0',
              // 自 2025-11-03 起，Firefox 新扩展必须声明数据收集类别。
              // 如实声明：扩展会把用户选中的网页文字发送到**用户自己配置**的
              // 模型服务商。不上报遥测，也不收集浏览记录、搜索词或健康/财务信息。
              data_collection_permissions: {
                required: ['websiteContent'],
              },
            },
          },
        }
      : {}),
  }),
});
