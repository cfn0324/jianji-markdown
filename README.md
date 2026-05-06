# 简记 Markdown

一个离线优先的手机 Markdown 写作和预览工具。页面、脚本和渲染库都放在本地，支持 KaTeX 数学公式和 Mermaid 图。

## 准备

```bash
npm install
```

安装会把 Markdown、KaTeX、Mermaid 复制到 `vendor/`，之后运行应用不需要外网。

## 本地运行

```bash
npm run serve
```

电脑打开 `http://127.0.0.1:4173`。手机和电脑在同一 Wi-Fi 下时，打开电脑的局域网地址，例如 `http://192.168.165.72:4173`。

## 离线和手机

直接打开 `index.html` 可以使用本地资源，适合完全离线查看和写作。浏览器通常不会为 `file://` 页面启用 PWA 缓存。

如果要在 Android 或 iOS 上“添加到主屏幕”并使用 Service Worker 离线缓存，需要通过 HTTPS 部署一次，或在设备本机用 `localhost` 访问。普通局域网 HTTP 地址适合预览和调试，但移动端浏览器通常不会注册 Service Worker。

## Android APK

当前目录已经可以生成安卓 APK。现成安装包是：

```text
JianjiMarkdown-debug.apk
```

改完网页代码后重新打包：

```bash
npm run android:build
```

如果 `tools/` 不存在，先运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\setup-android-tools.ps1
```

## GitHub 云端

应用内点右上角“云”打开 GitHub 设置，填写：

- Token：需要仓库 Contents 读写权限
- Owner：账号或组织名
- Repo：仓库名
- Branch：分支名，默认 `main`
- File path：Markdown 文件路径，例如 `notes/today.md`

“拉取”会把该路径的文件读入编辑器。“上传”会把当前编辑器内容写回该路径；文件不存在时会创建。

Token 只保存在当前设备本地。这个版本没有后端服务，不做 OAuth 跳转登录。

## 表格编辑

工具栏里的“表”会插入一个 2x2 内容表格。光标放在表格内时，可以使用“行+ / 行- / 列+ / 列-”调整表格。
