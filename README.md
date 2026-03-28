# MyDashboard

一个基于 Vite + React + Node 开发的个人效率面板，集成了待办事项、Markdown 笔记和文件收纳，支持自托管部署。

## 项目简介

本项目是一个三栏式工作台：

- **Todos**：管理任务，支持新增、编辑、完成、重要标记与拖拽排序  
- **Notes**：内置 Markdown 编辑与预览，支持代码高亮  
- **Files**：上传并管理文件，展示文件图标、大小与上传时间

后端使用 Node.js 提供 API 与静态资源服务，数据默认落盘到本地 `data/` 目录。

## 主要功能

- 任务管理（增删改查、完成状态、重要任务、分组显示）
- Markdown 笔记（Source/Preview 切换、语法高亮）
- 文件收纳（上传、下载、删除、列表展示）
- 简单认证（首次设置密码 + 登录态）
- 云端缓存与本地缓存协同

## 技术栈

- **前端**：React 18、TypeScript、Vite
- **编辑器/渲染**：CodeMirror 6、markdown-it、highlight.js
- **后端**：Node.js（原生 HTTP）+ tsx
- **上传处理**：busboy

## 目录结构

```text
my-dashboard/
├─ src/                 # 前端源码
├─ backend/             # 后端服务
├─ public/              # 静态资源（字体、主题、图标配置等）
├─ data/                # 运行时数据（任务/笔记/文件/认证）
├─ start-server.sh      # 一键构建并启动服务
└─ stop-server.sh       # 停止服务
```

## public 配置说明

`public/` 下的文件会在构建时原样拷贝到 `dist/`，运行时按 URL 直接读取。

- `notes-code-theme.json`：Notes 代码区主题配置（背景、前景、光标、选区、注释/字符串/关键字等颜色）
- `yazi-file-icons.json`：Files 面板的文件图标与颜色映射

前端在运行时通过 `fetch('/notes-code-theme.json')` 与 `fetch('/yazi-file-icons.json')` 读取配置，所以你修改后重新构建部署会生效。

`notes-code-theme.json` 当前支持两套字段（可混用）：

- ANSI 风格字段：`black/red/green/yellow/blue/purple/cyan/white` 与 `bright*`
- 语义字段：`comment/string/number/keyword/title/builtin/symbol/meta`

映射优先级：

- 语义字段优先（例如 `keyword`）
- 若语义字段缺失，则自动回退到 ANSI 对应颜色（例如 `red/brightRed`）

另外 `name` 是可选元数据字段，仅用于标识主题名称，不参与渲染。

基础 UI 与代码块环境相关字段：

- `background`
- `foreground`
- `cursorColor`
- `selectionBackground`
- `inlineCodeBackground`
- `codeBorder`

## 本地运行

### 1) 安装依赖

```bash
npm install
```

### 2) 前端开发模式

```bash
npm run dev
```

### 3) 构建生产包

```bash
npm run build
```

### 4) 启动后端服务（含静态资源）

```bash
npm run server
```

## 脚本启动（推荐部署）

```bash
./start-server.sh
```

该脚本会自动检查依赖、构建项目并启动服务。默认端口：

- `8081`（可通过环境变量 `TODO_SERVER_PORT` 覆盖）

停止服务：

```bash
./stop-server.sh
```

