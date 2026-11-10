# 划词问 AI

> 在任意网页上选中一段文字，用**你自己的 API Key** 直接向 AI 提问。
> 没有账号、没有中转服务器，也不绑定任何一家模型。

这是一个浏览器扩展（Chrome / Edge / Firefox）。它不提供模型，也不代理请求——
你把自己的模型服务配置进去，扩展只负责**把选中文字和你配置的服务商接起来**。

- 📄 项目定位与解决的问题（适合给非开发者看）：[docs/项目介绍.md](docs/项目介绍.md)
- 🔒 请求直达你配置的服务商，不经过本项目的任何服务器

---

## 你能用它做什么

在网页上选中一段文字后，选区下方会出现一条工具栏：

```
⠿  ◆ | 问问 AI   翻译   复制
```

| 操作 | 效果 |
|---|---|
| **问问 AI** | 打开侧边问答面板，自己输入问题（例如"解释这段""这有什么风险"） |
| **翻译** | 打开面板并自动开始翻译（中→英 / 英→中 自动判断） |
| **复制** | 只复制选中的文字，不发起任何模型请求 |

问答面板支持：

- **流式输出**：回答逐字出现，不用等全部生成完
- **停止生成**、**复制回答**、**重试**、**连续追问**（保留上下文）
- **拖动**：像手机小窗一样拖到任意位置，位置会被记住
- **收起**：收成侧边小标签，随时让开网页内容
- **挤压式停靠**（可选）：页面右侧让出空间，面板不再遮挡任何内容
- 回答按 Markdown 渲染（代码块、列表、表格），链接在新标签页打开

设置页可以配置：服务商名称、API Base URL、模型名、`temperature`、API Key，
以及查看完整的隐私与数据边界说明。

---

## 为什么用它

**1. 不绑定模型**
只实现 OpenAI-compatible 协议。DeepSeek、Moonshot、智谱、OpenAI，或本机的
Ollama / vLLM，填上地址和模型名就能用。按你自己的用量付费，不订阅第二份。

**2. 不经过中转**
架构里没有后端：浏览器后台直接请求你填的地址。没有账号系统、没有云端历史、没有遥测。

**3. 可以被审计**
权限最小化（**没有任何 host_permissions**），关键安全约束由单元测试和 ESLint 规则
强制执行——不是写在文档里的承诺。详见下文「安全设计要点」。

---

## 快速开始

### 1. 构建

```bash
git clone https://github.com/abayern/ASK-AI-browser-plugin.git
cd ASK-AI-browser-plugin
pnpm install
pnpm build:chrome        # 或 pnpm build:firefox
```

### 2. 加载到浏览器

**Chrome / Edge**

1. 打开 `chrome://extensions`（Edge 为 `edge://extensions`）
2. 打开右上角「开发者模式」
3. 点「加载已解压的扩展程序」，选择 `.output/chrome-mv3`

**Firefox**

1. 打开 `about:debugging#/runtime/this-firefox`
2. 点「临时载入附加组件」，选择 `.output/firefox-mv3/manifest.json`

### 3. 配置模型

1. 点工具栏上的扩展图标 → 弹窗 → **打开设置**
2. 填写服务商名称、API Base URL（必须以 `https://` 开头）、模型名
3. 填入你的 API Key 并保存

> 本地模型（如 Ollama）默认走 `http://`，会被安全策略拒绝。
> 需要在设置页的「高级：本地开发服务器」里显式勾选允许，且只放行
> `localhost` / `127.0.0.1` 这类回环地址。

### 4. 使用

1. 在任意网页点扩展图标 → **在本页启用划词**
2. 选中一段文字 → 点工具栏上的「问问 AI」
3. 输入问题，回车发送

---

## 开发

```bash
pnpm install          # 安装依赖
pnpm dev              # 开发模式（默认 Chrome）
pnpm dev:firefox      # 开发模式（Firefox）
pnpm typecheck        # 类型检查（wxt prepare + tsc --noEmit）
pnpm lint             # ESLint
pnpm test             # Vitest 单元测试
pnpm build:chrome     # 构建 Chrome / Edge
pnpm build:firefox    # 构建 Firefox
pnpm zip              # 打包
```

**技术栈**：WXT 0.21 · React 19 · TypeScript 5.9（strict）· zod 4 · Vitest 5 · ESLint 10

---

## 目录结构

```
core/                       与 UI 解耦的业务核心（无 React 依赖，可直接单测）
  config/                   配置类型、zod Schema、Base URL 与 Key 校验
    secret.ts               API Key 读写（**仅限 background 导入**）
    repository.ts           非敏感配置仓储（不接触 Key）
  messaging/                消息协议、来源判定、载荷校验、UI 侧客户端
  chat/                     上下文组装、后台会话（流式转发 / 取消 / 错误归一化）
  providers/                统一适配器接口、错误归一化、SSE 解析、OpenAI-compatible 实现
  markdown/                 Markdown 白名单消毒（解析后重建节点树）
  selection/                划词检测（纯逻辑）、工具栏定位、选区暂存
  storage/                  存储端口与浏览器 storage 适配器

components/                 UI 组件（只做展示，不含安全判定）
  settings/                 设置页各区块
  panel/                    面板内的 Markdown 渲染

entrypoints/
  background/index.ts       唯一可信上下文：消息分发、配置读写、聊天通道
  options/                  设置页
  panel/                    页内问答面板（扩展 origin 的 iframe）
  popup/                    工具栏弹窗（启用划词 / 打开设置）
  selection.ts              按需注入的划词脚本（未列入 manifest）

tests/                      Vitest 单元测试
docs/                       项目介绍文档
```

---

## 安全设计要点

| 约束 | 落地方式 |
|---|---|
| Key 与配置分离 | 两个独立存储键，删 Key 不影响配置，反之亦然 |
| UI 拿不到明文 | 状态响应只有 `{ configured, masked, updatedAt }`，**类型定义里就没有明文字段** |
| 只有后台能读 Key | ESLint 规则禁止 background 之外导入密钥模块，导入即报错 |
| Key 不进 URL / 请求体 / 日志 | 发送前自检地址不含 Key；错误只回显状态码与白名单化的错误标识 |
| 删除后立即失效 | 不做内存缓存，每次请求重新读存储 |
| 默认拒绝明文 http | 仅回环地址 + 用户显式开启例外；局域网 http 一律拒绝 |
| 阻断请求头注入 | API Key 只允许可打印 ASCII，空格 / CR / LF 全部拒绝 |
| 网页脚本读不到面板 | 面板运行在扩展 origin 的跨域 iframe 中 |
| 内容脚本只能提交文本 | 消息层做来源判定；内容脚本唯一可调用的消息是 `selection/set`（受限长度） |
| 网页文字不当指令执行 | 系统提示声明引用文字是不可信数据；历史只接受 user / assistant |
| Markdown 防 XSS | 解析后重建的白名单消毒：禁止原始 HTML、禁止图片与外部资源、链接只允许 http/https/mailto |
| 最小权限 | 仅 `storage` / `scripting` / `activeTab`，**无 host_permissions**；划词脚本按需注入 |

**边界说明**：浏览器本身、其它恶意扩展、被篡改的扩展代码，或拥有本机扩展执行权限
的攻击者，仍可能接触到凭证。本项目**不宣称 API Key 绝对安全**。

---

## 验证状态

| 项目 | 结果 |
|---|---|
| TypeScript | ✅ `tsc --noEmit` 0 错误（strict + noUncheckedIndexedAccess） |
| ESLint | ✅ 0 error / 0 warning |
| 单元测试 | ✅ **14 个测试文件 / 195 个用例全部通过** |
| 构建 Chrome / Edge | ✅ `.output/chrome-mv3/` |
| 构建 Firefox | ✅ `.output/firefox-mv3/` |

构建产物已核对：`permissions` 为 `storage` / `scripting` / `activeTab`，
**没有任何 host_permissions**；`web_accessible_resources` 仅声明面板页 `panel.html`；
manifest 为无 BOM 的合法 UTF-8。

### 测试覆盖范围（摘要）

- **Base URL / API Key**：https 接受、http 默认拒绝、回环例外、局域网拒绝、
  凭据/查询参数/片段/空白/超长/非法协议拒绝；Key 含空格与 CR/LF（头注入）拒绝
- **配置**：默认回退、未知字段丢弃、越界参数拒绝、存储损坏回退、存储抛错不崩溃
- **消息层**：来源伪造拒绝、内容脚本越权拒绝、畸形/超长载荷拒绝、额外字段过滤
  （含 `__proto__` 注入）、预设动作白名单
- **Provider**：流式增量、被切开的 SSE、心跳跳过、NDJSON、纯文本流、单个 JSON、
  HTML 错误页不当回答、断流判定、超时与用户取消区分、Key 不进 URL 与请求体
- **上下文**：注入文本只出现在引用块内、历史 system 角色被丢弃、长度预算
- **Markdown**：脚本、事件属性、`javascript:` / `data:` 链接、iframe/svg/math、
  外部图片引用等 XSS 向量

---

## 已知限制

- **每个页面需要点一次「在本页启用」**：目前是按需注入，权限持久化尚未实现
- **历史会话与长期记忆尚未开发**（原计划的阶段 5-6）
- 少数网站因自身 CSP 限制，可能无法嵌入面板
- 挤压式停靠会改动页面布局，个别站点（固定定位导航、全宽画布）可能错位，
  可在设置页随时关闭
- Chrome / Edge 与 Firefox 尚未完成三端完整人工回归
- 不使用原生侧边栏：Chrome 的 `sidePanel.open()` 要求用户手势，无法从网页内点击触发

---

## 工程环境说明

本机为受限沙箱环境，构建时遇到并已解决两个问题：

1. **pnpm 默认 symlink 布局不可用**（Node 不解开 Windows junction，导致
   `MODULE_NOT_FOUND`）→ 在 `pnpm-workspace.yaml` 设 `nodeLinker: hoisted`
2. **`@vitejs/plugin-react` 版本冲突**（6.x 要求 Vite 8）→ 用 `overrides` 收敛到 5.2.0

`.npmrc` 把 pnpm 的 store/cache/state 重定向到项目内目录。

另外：该沙箱禁止进程以管道 stdio 启动子进程，而 esbuild 需要以此方式启动编译器服务，
因此在**该环境**执行 `pnpm test` / `pnpm build` 需要放宽限制；普通开发机无此问题。

---

## 许可证

本项目采用 **[PolyForm Noncommercial License 1.0.0](LICENSE)**。

| 情形 | 说明 |
|---|---|
| ✅ **允许** | 个人学习、研究、试验、业余项目，以及教育、慈善等**非商业**用途下的使用、修改与分发 |
| ❌ **不允许** | 任何**商业用途**。商业使用需另行获得授权 |
| ⚠️ **请注意** | 这是 **source-available（源码可见）** 许可证，**不是** OSI 认可的开源许可证 |

如需商业授权，请通过仓库 Issue 联系作者。

第三方依赖（WXT、React、zod、marked 等）各自保留其原有许可证，详见各依赖包内的
LICENSE 文件。

---

*本项目采用 BYOK（Bring Your Own Key）模式。仓库不含任何真实密钥，
默认配置模板只包含公开的占位地址。*
