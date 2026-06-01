# apps 前端与桌面端说明

`apps/` 是 CodexManager 的前端与 Tauri 桌面壳工作区。

## 技术栈

- Vue 3
- Vite
- TypeScript
- Vue Router
- Pinia
- Axios
- Element Plus
- SCSS
- Tauri v2
- npm

## 页面范围

当前前端只保留 6 个页面：

```text
账号管理
聚合API
平台密钥
模型管理
请求日志
设置
```

## 目录结构

```text
apps/
├─ src-vue/           # Vue 前端源码
├─ src-tauri/         # Tauri 桌面壳、Rust 命令、打包配置
├─ index.html         # Vite HTML 入口
├─ vite.config.ts     # Vite 配置
├─ package.json       # npm 脚本与依赖
├─ package-lock.json  # npm 锁文件
└─ out/               # Vite 静态构建产物
```

## 常用命令

```powershell
npm install
npm run dev:desktop
npm run build:desktop
```

说明：

- `npm run dev:desktop`：启动 Vite 前端开发服务器，默认端口 `3005`。
- `npm run build:desktop`：执行 `vue-tsc --noEmit && vite build`，产物输出到 `out/`。
- Tauri 构建读取 `src-tauri/tauri.conf.json` 中的 `frontendDist: "../out"`。

## API 与 IPC

- 桌面端通过 Tauri `invoke` 调用本地命令。
- 前端 API 封装集中在 `src-vue/api/`。
- 服务类命令继续使用 `withAddr()` 注入服务地址。
- 前端不直接使用 Tailwind、shadcn、TanStack Query、Next.js 或 React。

## GitHub Release

`release-all.yml` 只保留 Windows 桌面与 Windows service 打包链路：

```text
npm ci
  ↓
npm run build:desktop
  ↓
上传 apps/out 前端产物
  ↓
Windows Tauri nsis 打包
  ↓
上传 exe 产物
```
