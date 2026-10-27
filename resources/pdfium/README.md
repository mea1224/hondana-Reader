`npm run dist` 会自动从 PDFium 官方发布源下载与 `pdfium-render` 绑定版本匹配的动态库，并放入此目录供 electron-builder 打包。下载器会核对 GitHub 发布信息提供的 SHA-256，并附带压缩包内的许可/声明文件。

如需手动安装，可把官方 PDFium 发行包中的动态库放入此目录：

- macOS：`libpdfium.dylib`
- Windows：`pdfium.dll`
- Linux：`libpdfium.so`

开发运行时也可设置 `HONDANA_PDFIUM_DIR` 指向该库所在目录。PDFium 二进制由构建脚本按目标系统和 CPU 架构下载，未提交到源码仓库；`HONDANA_PDFIUM_TAG` 可用于选择其他 PDFium 发布标签。
