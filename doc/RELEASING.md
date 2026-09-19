# 发布版本与应用更新

Pi-CodeLoom 使用 `electron-updater` 检查本仓库的正式 GitHub Release。更新来源固定为 `by-guci/Pi-CodeLoom`，客户端不需要 GitHub Token。

## 用户操作

- 安装版启动后约 10 秒检查更新，之后每 6 小时检查一次；可在 **设置 → 关于 → 应用更新** 关闭自动检查。
- 发现新版本后显示提醒，可查看说明、下载更新，或者忽略该版本。
- 下载完成后点击 **重启并安装**。普通退出不会自动安装；有运行中的任务或未保存的设置时，应先处理再安装。
- 网络、文件校验或安装失败会显示错误，支持重试或打开发布页。
- 开发模式不检查远端更新，避免用源码运行时误安装发布版。

## 平台范围

| 平台或格式 | 更新方式 |
| --- | --- |
| Windows NSIS 安装版 | 应用内下载，确认后启动安装程序并重启。 |
| Windows Portable | 检查并提醒，前往发布页手动下载替换。 |
| macOS | `electron-updater` 支持已签名的应用；自动更新需要正确的 Apple 签名。未签名的发布包应手动下载安装。 |
| Linux AppImage | 应用内下载并安装；通过 AppImage 启动时需要正常提供 `APPIMAGE` 环境变量。 |
| Linux deb 等其他形式 | 前往发布页手动更新。 |

## 发布流程

在 Windows 上，可双击根目录的 `build-exe.cmd`，或运行 `npm run package:exe`，生成本地 NSIS 安装包及更新元数据。输出位于 `dist/`；脚本不会创建 GitHub Release。

先提交本次功能修改，确保 `CHANGELOG.md` 包含目标版本的说明。以下以从 `1.0.7` 发布 `1.0.8` 为例：

```bash
npm version 1.0.8 --no-git-tag-version
# 在 CHANGELOG.md 添加 ## [1.0.8] 和本版更新说明
npm run typecheck
npm run lint
npm run test:unit
npm run build
npm run test:scripts
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore(release): prepare 1.0.8"
git push origin main
git tag v1.0.8
git push origin v1.0.8
```

`v*` 标签触发 `.github/workflows/release.yml`，构建 Windows、macOS 和 Linux 包后创建正式 Release。标签必须与 `package.json` 的版本号一致。当前客户端仅检查正式版，不订阅预发布版本，也不降级。

发布产物必须包含：

- Windows 安装包及 `latest.yml`。
- macOS 的 ZIP/DMG 及 `latest-mac.yml`；ZIP 是 macOS 自动更新所需产物。
- Linux AppImage 等产物及 `latest-linux.yml`。
- 打包器生成的 `.blockmap` 文件（如有），供差分下载使用。

这些元数据由 `electron-builder` 生成，包含版本、文件名称、大小和 SHA-512 校验值。工作流会上传它们并检查缺失，不能在上传后改名安装包或手动改写校验值。普通源码 push 不会发布新版本。

## 首次启用与验证

之前没有更新模块的安装包无法自行获得这项能力。需要先让用户手动安装一个包含本次接入的正式版本；此后发布更高版本，才能验证完整的线上升级流程。

仓库的 `e2e/app-update.spec.ts` 使用真实的 `electron-updater` 和本地模拟发布源，验证版本检测、下载进度、损坏文件拒绝、重试和安装调用；不会执行测试安装包。它不替代已签名/已打包应用在目标系统上的真实覆盖安装验证。

## English summary

Updates come from stable GitHub Releases in `by-guci/Pi-CodeLoom`. Checks run after launch and every six hours, with manual controls under **Settings → About → App updates**. Downloads and installation both require explicit user actions. Normal app exit does not install an update.

Windows NSIS and Linux AppImage support in-app installation. Windows Portable and other Linux packages use manual downloads. macOS automatic updates require a signed app and the ZIP artifact.

Keep the version in `package.json`, the lockfile, changelog section, and `v<version>` Git tag consistent. Preserve all generated `latest*.yml` and `.blockmap` files beside the matching installers in the Release. Existing clients without an updater must first install a baseline release manually.
