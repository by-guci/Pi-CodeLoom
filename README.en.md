<div align="center">

<img src="resources/icon.svg" alt="Pi-CodeLoom" width="80" height="80" />

# Pi-CodeLoom

A desktop workspace for AI coding, project files, and conversations.

[简体中文](./README.md) · **English**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Electron](https://img.shields.io/badge/Electron-43-47848F?logo=electron)](https://www.electronjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript)](https://www.typescriptlang.org/)

[Releases](https://github.com/by-guci/Pi-CodeLoom/releases) · [Issues](https://github.com/by-guci/Pi-CodeLoom/issues) · [Upstream](https://github.com/justhil/pi-app)

</div>

## About

**Pi-CodeLoom is an open-source desktop client for AI coding assistance, developed from [justhil/pi-app](https://github.com/justhil/pi-app).**

This is an unofficial derivative maintained independently of upstream. It builds on the original Electron desktop architecture and pi coding agent, with further work on the interface, color palettes, conversation navigation, and everyday usability. Thanks to **justhil**, the pi project, and the community for their open-source contributions.

With a configured model provider, Pi-CodeLoom can help read code, edit files, run commands, and inspect changes. Manage project folders, conversation history, tool activity, and file previews from one desktop interface.

## Features

| Feature | Description |
| --- | --- |
| Models and providers | Configure providers, switch available models, and select supported reasoning levels. |
| Projects and sessions | Open local projects and manage history, temporary chats, branches, and session trees. |
| Conversation outline | Centered markers on the left; hover to preview a question and reply, click to jump, and follow the active turn while scrolling. |
| 16 built-in palettes | Paired light and dark variants, system appearance, instant preview, and custom adjustments. |
| Streaming and tool activity | Markdown, code, formulas, reasoning output, and collapsible tool calls. |
| Files and review | File explorer, tabbed previews, drag-and-drop attachments, code diffs, and Git workspace information. |
| Extensions and skills | Use the pi extension ecosystem with desktop adapters for supported tools and interactions. |
| Plugin store | Browse the official pi.dev catalog, search and filter packages, install user-level npm packages, check for updates, and uninstall. Selected packages include editorial Chinese summaries. |
| Notifications | Completion alerts, an inbox, background task status, and notification preferences. |
| Bilingual interface | Switch between Chinese and English in settings. |

### Built-in palettes

Open **Settings → Appearance → Interface theme**, choose a palette, and click **Save** at the bottom.

| | | | |
| --- | --- | --- | --- |
| Claude · Clay | Codex · Graphite | Nord · Aurora | Rosé Pine · Moon |
| Catppuccin · Cream | Tokyo · Neon | Gruvbox · Dune | Ledger · Brass |
| Mosswood | Ocean · Tide | Jade Mist | Sakura Ink |
| Amber Voyage | Violet Dusk | Moonstone | Citrus Terminal |

![Light and dark previews of the 16 built-in palettes](./doc/images/themes.png)

## Install and run

### Desktop downloads

Check [Releases](https://github.com/by-guci/Pi-CodeLoom/releases) for published packages. If no release is available yet, run the project from source using the instructions below.

The Windows packaging configuration includes installer and portable builds. macOS and Linux packaging configurations are also included; available platforms and versions depend on the artifacts actually published in Releases.

### Run from source

You need **Node.js 22.19.0 or later** (Node.js 22 LTS recommended), npm, and Git.

```bash
git clone https://github.com/by-guci/Pi-CodeLoom.git
cd Pi-CodeLoom
npm ci
npm run dev
```

`npm ci` runs the project's post-install steps, including native dependency preparation and a build. Allow time for dependencies to download on the first install.

To stop development mode, quit the application and press `Ctrl+C` in the terminal. If another launch does not open a new window, quit the existing instance through its tray menu first.

### First-time setup

1. Check the **Pi runtime** in settings and choose the bundled, global, or independently installed environment as needed.
2. Configure model providers, models, and credentials in **Models** and the relevant settings pages. The app does not include model accounts or API credits.
3. Open a project folder, then choose an existing session or start a new conversation.
4. Select a model and send a message. Use the right panel to inspect files, tool activity, and code changes.
5. Choose a palette, appearance mode, and icon style in **Appearance**.

Existing terminal pi configuration can be reused. Model credentials, extensions, and related pi settings typically live under `~/.pi/agent`; desktop preferences are stored in Electron's user data directory.

### Plugin store

Open **Settings → Plugin store** to browse the official catalog, or use **Installed** to check for updates, update/repair, and uninstall packages. Operations apply immediately. Exit and restart the app after installing or updating. Package changes are blocked while tasks are running, and existing version constraints are preserved. Selected packages have Pi-CodeLoom Chinese summaries with the author's original description available; no translation service is called.

This version manages npm packages in the host Pi user environment. Continue using the Pi CLI for project-level, Git, and local-path packages. WSL mode supports browsing; manage installations in the corresponding WSL terminal. Catalog packages are community-authored, and desktop interaction support depends on each plugin and its adapters.

## Keyboard shortcuts

| Action | Shortcut or entry point |
| --- | --- |
| Send message | `Enter` |
| Insert newline | `Shift+Enter` |
| Stop generation | `Esc` |
| Open session tree | Press `Esc` twice with an empty composer |
| Browse slash commands | `/` |
| Add attachments | Drag files, click `+`, or paste an image |
| Navigate the outline | Focus a marker, then use `↑`, `↓`, `Home`, or `End`; press `Enter` to jump |
| Dismiss outline preview | `Esc` or move the pointer away |

## Build and development

**Build a Windows EXE installer**: double-click [`build-exe.cmd`](./build-exe.cmd) in the project root, or run `npm run package:exe`. The script checks Node.js, installs dependencies when build tools are missing, checks types, builds the app, and generates an x64 NSIS installer. It stops and reports the error if any step fails.

Output: `dist/Pi-CodeLoom-Setup-<version>-x64.exe`, along with `latest.yml` and `.blockmap` update files. The script builds locally without publishing or installing the application. To reinstall dependencies, run `npm ci` first.

```bash
npm run typecheck     # TypeScript checks
npm run lint          # Lint source code
npm run test:unit     # Unit and component tests
npm run test:scripts  # Script and contract tests
npm run build         # Build main, preload, and renderer
npm run test:e2e      # Desktop end-to-end tests; run build first
npm run package:win   # Windows installer and portable packages
```

Packages are written to `dist/`. On macOS or Linux, use `npm run package` to package for the current platform. If a native dependency reports an ABI mismatch, run `npm run rebuild:native` and restart.

Stack: **Electron 43 · React 18 · TypeScript · Vite · Tailwind CSS · Zustand · i18next · pi SDK**.

## Documentation and extensions

- [Getting started](./doc/guide/getting-started.md)
- [Desktop adapter catalog](./doc/guide/adapters.en.md)
- [Adapter authoring guide](./doc/adapter-authoring-guide.md) (Chinese)
- [Contribution and development notes](./doc/CONTRIBUTING.md) (Chinese)

Desktop interaction support depends on the extension's adapter; see the catalog for scope. You may need to reopen the session after adding models, extensions, or skills.

## Feedback and contributions

Bug reports, suggestions, and pull requests are welcome. Open an [issue](https://github.com/by-guci/Pi-CodeLoom/issues) with the app version, operating system, reproduction steps, and sanitized logs.

Updates use `electron-updater`. Open **Settings → About → App updates** to check, download, and restart to install. Automatic checks, download progress, retries, and skipping versions are supported; portable builds provide manual download links. First install a released build that includes the updater. See [Release and update instructions](./doc/RELEASING.md) for the publishing workflow and platform requirements.

## Credits and license

- **[justhil/pi-app](https://github.com/justhil/pi-app)**: the direct upstream project that Pi-CodeLoom is based on. Thanks to its author for the desktop client, extension adapters, and foundations.
- **[pi](https://github.com/jvm/pi-mono)**: the underlying coding agent and extension ecosystem.
- Thanks to the maintainers of React, Electron, other dependencies, and all community contributors.

Licensed under the [MIT License](./LICENSE), with the upstream copyright notice preserved. Pi-CodeLoom is independently maintained and is not an official upstream release.
