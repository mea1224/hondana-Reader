<p align="center">
  <img src="./icon.jpeg" alt="hondana Reader 图标" width="160">
</p>

<h1 align="center">hondana Reader</h1>

<p align="center">一款本地优先的桌面阅读器，用来整理图书、阅读内容并记录笔记。</p>

## 项目介绍

hondana Reader 使用 Electron、Next.js、React 和 Rust 构建。图书文件保存在本地，应用通过 Rust 核心读取书籍、保存书架数据和笔记，不需要连接远程服务。

目前支持导入 EPUB、PDF 和 Markdown 文件。书架支持按书名和作者搜索；阅读界面支持目录导航和进度保存。EPUB 保留图片和注音排版；笔记支持文字高亮、多处标记、图片涂抹，以及笔记文字的加粗、颜色和下划线格式。PDF 页面由 PDFium 渲染。

## 项目组织

```text
.
├── app/                 Next.js 页面、全局样式和应用入口
├── components/          书架、阅读器、目录、笔记和图片标注等界面组件
├── lib/                 前端类型、API、EPUB 注音、选区和笔记辅助逻辑
├── electron/            Electron 主进程、预加载、安全校验、工作线程和平台图标
├── rust-core/           Rust 原生核心：图书解析、PDF 渲染和本地数据存储
├── native/              构建生成的 Node 原生模块（不提交到版本库）
├── resources/pdfium/    构建时下载并随应用打包的 PDFium 动态库
├── scripts/             原生模块构建、PDFium 下载和原生模块测试脚本
├── tests/               应用、注音、笔记、存储与 PDFium 下载器测试
├── out/                 Next.js 静态导出目录（构建生成）
├── release/             桌面安装包输出目录（构建生成）
├── icon.jpeg            项目根目录的图标图片（README 顶部展示）
└── package.json         npm 命令、依赖和 electron-builder 打包配置
```

## 环境要求

- Node.js 22 或更高版本及 npm
- Rust 稳定版工具链（`rustc` 和 `cargo`）
- 对应平台的 C/C++ 构建工具链
- 首次安装依赖和打包时需要网络，以下载 npm 依赖、Electron 和 PDFium

Windows 上请安装 Visual Studio Build Tools，并选择 C++ 构建工具；Rust 应使用 MSVC 工具链。macOS 需要 Xcode Command Line Tools。Linux 需要系统 C/C++ 编译器及 `make`。

## 开发运行

在项目根目录执行：

```bash
npm ci
npm run native:build
npm run pdfium:download
npm run dev
```

`npm run dev` 会启动 Next.js 开发服务器和 Electron 桌面窗口。`native:build` 根据当前操作系统和 CPU 架构编译 Rust Node 模块；`pdfium:download` 下载相同平台和架构的 PDFium 动态库。阅读 PDF 时需要 PDFium，因此开发时请先运行下载命令。

只运行浏览器开发服务器可使用 `npm run dev:web`。浏览器预览模式不等同于完整桌面应用，桌面端的 EPUB、PDF 和本地存储能力需要 Electron 与原生模块。

## 检查和构建

运行类型检查与自动化测试：

```bash
npm run check
```

构建静态前端资源：

```bash
npm run build
```

`npm run build` 只生成 Next.js 静态页面，不会编译 Rust 核心或创建桌面安装包。桌面安装包应使用下方对应平台的打包命令。

## 各平台编译

打包流程会自动下载并校验 PDFium、以 Release 模式编译 Rust 核心、构建前端，然后调用 electron-builder。原生模块和 PDFium 都与操作系统及 CPU 架构绑定，因此建议在目标系统和目标架构的机器上执行打包；当前没有配置跨系统或通用二进制交叉编译。

### macOS

在 macOS 上安装 Xcode Command Line Tools，然后在项目根目录运行：

```bash
npm ci
npm run check
npm run dist
```

默认按照当前 Mac 的 CPU 架构构建，产物包括 DMG 和 ZIP，输出在 `release/`。Apple Silicon 会生成 arm64 产物，Intel Mac 会生成 x64 产物。项目尚未配置 universal（arm64 + x64）合并包。签名和公证需要开发者证书及相应的环境配置；没有证书时仍可本地打包，但应用不会经过开发者签名。

### Windows

在 Windows 上安装 Node.js、Rust MSVC 工具链和 Visual Studio C++ Build Tools，然后在 PowerShell 或命令提示符中运行：

```powershell
npm ci
npm run check
npm run dist
```

默认生成 NSIS 安装程序，位于 `release/`。原生模块按当前 Windows CPU 架构构建。首次运行可能需要允许脚本或工具链下载 Electron、npm 依赖和 PDFium。

### Linux

在 Linux 上安装 Node.js、Rust 工具链、C/C++ 编译器和 `make`，然后运行：

```bash
npm ci
npm run check
npm run dist -- --linux AppImage
```

该命令生成 AppImage，产物位于 `release/`。如需构建 Debian 包，可将最后一行改为：

```bash
npm run dist -- --linux deb
```

Linux 原生模块和 PDFium 按当前 CPU 架构构建。运行打包程序时若系统缺少 Electron 所需的图形库或其他运行库，请按发行版安装相应依赖。

### 架构和产物说明

- 当前支持 x64 和 ARM64 的 PDFium 下载；其他架构会在下载阶段报错。
- 构建使用当前机器的操作系统和 CPU 架构，不要将某个平台生成的 `native/*.node` 或 PDFium 动态库用于其他平台。
- macOS 目标为 DMG、ZIP；Windows 目标为 NSIS；Linux 可通过 electron-builder 参数生成 AppImage 或 deb。
- `npm run dist` 的完整脚本等价于依次下载 PDFium、Release 构建原生模块、构建前端和运行 electron-builder。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动开发服务器和 Electron |
| `npm run dev:web` | 仅启动 Next.js 开发服务器 |
| `npm run native:build` | 编译当前平台的 Rust Node 模块 |
| `npm run native:test` | 运行原生模块测试 |
| `npm run pdfium:download` | 下载当前平台的 PDFium 动态库 |
| `npm run typecheck` | 运行 TypeScript 类型检查 |
| `npm test` | 运行自动化测试 |
| `npm run check` | 运行类型检查和自动化测试 |
| `npm run build` | 构建前端静态资源 |
| `npm run dist` | 构建并打包当前平台桌面应用 |

PDFium 下载器默认从官方发布源取得与 Rust PDFium 绑定匹配的版本，并校验 SHA-256。可使用 `HONDANA_PDFIUM_TAG` 选择 PDFium 发布标签；网络环境需要镜像时，可通过 `HONDANA_PDFIUM_MIRROR` 设置下载镜像前缀。
