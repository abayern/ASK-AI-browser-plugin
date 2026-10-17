# 划词问 AI（BYOK 浏览器扩展）

选中网页文字后，向你**自己配置**的 AI 服务商提问。API Key 只存在本地扩展存储中，
请求由扩展后台直接发往你配置的服务商，不经过本产品自有后端。

> 当前进度：**阶段 0-2 已完成并全部验证通过**（项目骨架、配置 Schema、存储封装、消息通信层、设置页）。
> Provider 适配器、流式输出、划词悬浮按钮、侧边栏 UI、历史会话、长期记忆尚未开始。
> 目前有**一个**可用界面：设置页（扩展工具栏图标或「扩展选项」进入）。

## 技术栈

- 扩展框架：WXT 0.21
- 前端：React 19 + TypeScript 5.9（strict）
- 校验：zod 4
- 测试：Vitest 5
- 规范：ESLint 10 + typescript-eslint

## 目录结构

```
core/                       与 UI 解耦的业务核心（无 React 依赖，可单测）
  config/
    types.ts                纯类型：ProviderConfig / AppSettings / ApiKeySummary
    constants.ts            存储键（API Key 使用独立键）
    validate.ts             Base URL 与 API Key 校验、脱敏
    schema.ts               zod Schema + 默认配置模板
    repository.ts           非敏感配置仓储（不接触 Key）
    secret.ts               API Key 读写（**仅限 background 导入**）
  messaging/
    types.ts                消息协议与响应类型（结构上不含 Key 明文）
    guard.ts                来源判定 + 载荷校验 + 来源白名单
    envelope.ts             响应解包（纯函数，可单测）
    client.ts               UI 侧消息客户端（不含密钥逻辑）
  storage/
    types.ts                KeyValueStore 端口
    wxt-store.ts            浏览器 storage 适配器（仅扩展上下文用）
  shared/                   通用 limits 与 Result 类型
components/settings/        UI 组件（只做展示，不含安全判定）
  Section.tsx               区块容器（页边标签 + 细线）
  ProviderForm.tsx          服务商与模型配置表单
  ApiKeyPanel.tsx           API Key 管理（脱敏展示 / 替换 / 删除）
  PrivacyNotice.tsx         隐私与数据边界说明
entrypoints/
  background/index.ts       唯一可信上下文：消息分发、配置读写
  options/                  设置页（React，独立标签页打开）
    index.html / main.tsx / App.tsx / style.css
tests/                      Vitest 单元测试
```

## 命令

```bash
pnpm install          # 安装依赖
pnpm typecheck        # 类型检查（wxt prepare + tsc --noEmit）
pnpm lint             # ESLint
pnpm test             # Vitest 单元测试
pnpm dev              # 开发模式（默认 Chrome）
pnpm dev:firefox      # 开发模式（Firefox）
pnpm build:chrome     # 构建 Chrome / Edge
pnpm build:firefox    # 构建 Firefox
pnpm zip              # 打包
```

## 安全设计要点（阶段 1-2 已落地）

1. **Key 与配置物理分离**：`secret.apiKey.v1` 与 `settings.v1` 是两个独立存储键，
   删 Key 不影响配置，清配置也不影响 Key。
2. **UI 拿不到明文**：`config/getStatus` 只返回 `{ configured, masked, updatedAt }`，
   连响应**类型定义**里都没有明文字段。
3. **ESLint 强制边界**：除 `entrypoints/background/**` 外，任何文件导入
   `core/config/secret` 都会报错——「Content Script 拿不到 Key」是机制保证而非口头约定。
4. **无内存缓存**：每次请求都重新读存储，因此删除 Key 后旧值立即失效。
5. **默认拒绝 http**：仅当用户显式开启本地开发例外、且主机是回环地址时才放行；
   局域网 http 地址一律拒绝。
6. **阻断头注入**：API Key 只允许可打印 ASCII，空格 / CR / LF 全部拒绝。
7. **URL 卫生**：拒绝带用户名口令、查询参数、片段的地址，防止参数被拼进请求。
8. **最小权限**：当前只申请 `storage`。`activeTab` / `scripting` 与可选主机权限
   将在阶段 4 真正需要时再加，不提前申请 `<all_urls>`。
9. **Firefox 隐私声明**：`browser_specific_settings.gecko.data_collection_permissions`
   如实声明 `required: ["websiteContent"]`（选中文字会发往用户自己配置的服务商），
   不声明任何遥测类目。
10. **设置页从不回填 Key**：页面拿不到明文，因此「重新打开设置页自动填充」
    在结构上不可能发生；保存成功后立即清空输入框与内存中的草稿。

## 验证状态（已实际执行）

| 项目 | 结果 | 细节 |
|---|---|---|
| TypeScript 类型检查 | ✅ 通过 | `tsc --noEmit`，0 错误 |
| ESLint | ✅ 通过 | 0 error / 0 warning |
| 单元测试 | ✅ 通过 | **6 个测试文件 / 72 个用例全部通过** |
| 构建 Chrome | ✅ 通过 | `.output/chrome-mv3/`，含 `options.html`，`permissions: ["storage"]` |
| 构建 Firefox | ✅ 通过 | `.output/firefox-mv3/`，含 `options.html` 与 `data_collection_permissions` |
| 构建 Edge | ✅ 复用产物 | Edge 为 Chromium 内核，直接使用 `chrome-mv3` 产物（**未在 Edge 上实机运行**） |

构建产物已核对：manifest 为无 BOM 的合法 UTF-8，中文名称/描述正确，
`permissions` 仅含 `storage`，且**没有任何 host_permissions**。

### 测试覆盖的用例范围

- Base URL：https 接受、http 默认拒绝、回环地址例外、局域网 http 拒绝、
  用户名口令/查询参数/片段/空白/超长/非法协议拒绝、末尾斜杠归一化
- API Key：非字符串/空/过短/过长/含空格与换行（头注入）拒绝、脱敏只显示末 4 位
- 配置 Schema：默认回退、未知字段丢弃、越界 temperature 拒绝、存储损坏回退
- Key 仓储：写入/读回、summary 不含明文、清除后立即失效、存储被篡改视为未配置、
  存储抛错不崩溃
- 消息层：来源伪造拒绝、内容脚本无权配置操作、未知类型/畸形载荷/超长载荷拒绝、
  额外字段过滤（含 `__proto__` 注入）
- 响应解包：成功取 data、失败抛 code、畸形响应按传输错误、缺 data 不算成功、
  非字符串 code 降级不渗入界面

## 环境相关的工程决策（重要）

开发机为受限沙箱环境，安装与构建时遇到并已解决两个问题：

1. **pnpm 默认 symlink 布局不可用**：Node 的模块解析在此环境不会解开 Windows
   junction，导致依赖存在却 `MODULE_NOT_FOUND`。已在 `pnpm-workspace.yaml`
   设 `nodeLinker: hoisted`，生成真实目录树（行为同 npm）。
2. **`@vitejs/plugin-react` 版本冲突**：pnpm 会解析到 6.x，而 6.x 要求 Vite 8
   （子路径 `vite/internal` 不存在）。已用 `overrides` 收敛到 5.2.0，
   该版本同时兼容 Vite 7 与 8。

`.npmrc` 把 pnpm 的 store/cache/state 重定向到项目内目录，避免写入用户目录失败。

另外：本沙箱禁止进程以管道 stdio 启动子进程，而 esbuild 需要以此方式启动编译器服务，
因此在**本机**执行 `pnpm test` / `pnpm build` / `pnpm dev` 需要放宽该限制；
普通开发机上无此问题。

## 已知限制

- 设置页目前只能配置「服务商 / API Key / 隐私说明」。任务书要求的
  「清空历史会话」「关闭长期记忆」「删除全部长期记忆」三项操作，
  要等阶段 5-6 真正有对应数据后才能提供——不会先放一个点了没反应的按钮。
- 设置页尚未在真实浏览器中目视验证：构建产物正确，但配色的实际观感、
  深色模式与窄屏表现需要你在 Chrome/Edge/Firefox 里加载 `.output/*` 亲自看一眼。
- Chrome / Edge 的 `sidePanel` 与 Firefox 的 `sidebar_action` 是**两套不兼容 API**；
  且 Chrome `sidePanel.open()` 要求用户手势。阶段 4 将按既定方案以「页内 Shadow DOM
  面板为主、侧边栏为辅」并通过适配层处理。
- 工具栏图标当前只用于打开设置页；阶段 4 会重新设计它的行为。
- 未表态「API Key 绝对安全」：浏览器本身、恶意扩展或被篡改的扩展代码仍可能接触凭证。
