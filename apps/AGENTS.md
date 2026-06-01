# Frontend Engineering Standards (apps)

This document outlines the architectural constraints and coding conventions for the Vue frontend.

## 1. Tech Stack

- **Framework**: Vue 3 + Vite.
- **Language**: TypeScript.
- **Routing**: Vue Router.
- **State Management**: Pinia.
- **HTTP Client**: Axios.
- **UI Components**: Element Plus.
- **Styling**: SCSS with nested syntax.
- **Runtime**: Tauri v2.
- **Package Manager**: npm.

## 2. Page Scope

Only these six frontend pages are in scope:

- 账号管理
- 聚合API
- 平台密钥
- 模型管理
- 请求日志
- 设置

Do not add plugin, author, sponsor, landing, or test pages unless explicitly requested.

## 3. Styling

- Use SCSS nested syntax for Vue component styles.
- Do not use Tailwind CSS.
- Keep the desktop UI dense, quiet, and operational.
- Keep cards at 8px border radius or less.
- Avoid decorative gradient orbs and marketing-style hero layouts.

## 4. API & IPC Standards

- Use the centralized helpers in `src-vue/api/transport.ts`.
- Use `withAddr()` for service commands that call the backend service.
- Keep response shape normalization in `src-vue/api/normalize.ts`.
- Do not use browser `fetch()` for desktop IPC commands.

## 5. Directory Structure

- `src-vue/`: Vue application source.
- `src-vue/api/`: API and IPC wrappers.
- `src-vue/layout/`: Application shell.
- `src-vue/router/`: Vue Router configuration.
- `src-vue/views/`: Six page views.
- `src-vue/styles/`: Shared SCSS.
- `src-tauri/`: Tauri desktop shell and Rust commands.

## 6. Development Workflow

- Use npm commands only.
- Validate frontend build with `npm run build:desktop` when build compatibility matters.
- Do not add test tooling unless explicitly requested.
