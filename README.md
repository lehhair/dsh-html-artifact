# dsh-html-artifact

HTML 实时渲染插件：模型通过专门的 `artifact` 工具创建/修补 HTML 文档，GUI 在沙箱 iframe 里**实时渲染**。核心区别：模型**打 patch**（`old_string`/`new_string`，和文件 `edit` 工具同一套语义），而不是每次重发整个 HTML —— 只传增量，预览原地更新。

纯扩展实现，**不改 harness core**：

- 服务端：`artifact` 工具（create / patch / read / destroy / list），per-session 注册表；`card: 'artifact'` 渲染意图通过 `presentResult` 走线（core 的 union 不认识这个 card，返回值做了边界强转，客户端未知 card 自动降级 generic）。
- 客户端：`tool.call.toolview` keyed slot 注册 `artifact` 行的原子视图，沙箱 iframe（CSP `default-src 'none'` + `sandbox="allow-scripts"` 不透明源 + 主题变量 + 尺寸桥 + 存储 shim），同一 artifact id 的后续 patch 调用原地更新预览。

## 安装

发布版走 GitHub Releases 的 tarball（`dsh plugin` 安装后自动加入 profile 层栈）：

```sh
dsh plugin --profile web add "https://github.com/lehhair/dsh-html-artifact/releases/download/v0.1.0/dsh-external-dsh-html-artifact-0.1.0.tgz"
```

然后重启 dsh web 服务，刷新页面。**不要**用 `dsh plugin add github:lehhair/dsh-html-artifact` 安装源码（仓库的 `lib/` 被 gitignore，源码安装没有构建产物）。

## 用法

模型侧（工具描述已内置）：

1. `artifact create { title?, html? }` —— 创建，GUI 立即渲染沙箱预览。
2. `artifact patch { id, old_string, new_string, replace_all? }` —— 对已有 artifact 打补丁，只发变更；每个 patch 调用结算后预览原地更新，会话里显示一行旧/新对比。
3. `artifact read { id }` / `artifact destroy { id }` / `artifact list` —— 读取源码 / 关闭 / 枚举。

安全边界：预览在 `srcdoc` iframe 中，CSP `default-src 'none'`（脚本/样式允许内联，外部 https/http 资源允许），iframe 无 `allow-same-origin`（不透明源），artifact 脚本无法触达宿主文档；localStorage/sessionStorage 被内存 shim 替代。

## 开发

```sh
pnpm install        # devDeps 是 link: 到 ../dsh2026/deepseek-harness 的本地 checkout
pnpm run check      # typecheck + test + build
```

测试：`tests/registry.spec.ts`（服务端纯逻辑：替换语义、字节上限、截断、错误分类）+ `tests/artifact-row.spec.tsx`（客户端渲染：沙箱 iframe、patch 对比、跨调用实时更新、destroy/list/read 分支）。

CI（`.github/workflows/build-release.yml`）：发布时 checkout 固定 ref 的 harness 构建后打包 tarball 上传到 Release。注意：**同 URL 重建 release 会命中 pnpm 的 URL 缓存**，出新版本务必 bump version。
