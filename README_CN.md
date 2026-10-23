<p align="center"><img src="res/sparkler.svg" width="256"></p>

<p align="center">适用于 GNOME 的动态壁纸</p>
<p align="center">Hanabi 花火【はなび】（名词）烟花</p>
<p align="center">( ・ω・)o─━・*:'・:・゜'・:※</p>

# GNOME Shell 扩展 - Hanabi

[English](README.md) | **简体中文**

如果你喜欢我的项目，欢迎请我喝杯咖啡！！(⁎˃ ꇴ ˂⁎)ｯ

[![Github-sponsors](https://img.shields.io/badge/sponsor-30363D?style=for-the-badge&logo=GitHub-Sponsors&logoColor=#EA4AAA)](https://github.com/sponsors/jeffshee)
[![Ko-Fi](https://img.shields.io/badge/Ko--fi-F16061?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/jeffshee)
[![BuyMeACoffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/jeffshee)

另外，别忘了点一下 Star！🌟  
遇到问题或有任何建议，欢迎随时提交 issue 🤗  
非常感谢你的支持！

## 加入我们的 Discord！

[![Discord](https://img.shields.io/badge/Discord-%235865F2.svg?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/mP7yg4gX7g)

## 演示 📽️

点击图片即可观看（将跳转到 YouTube）

[![](https://i3.ytimg.com/vi/BWjXl4h9_BA/maxresdefault.jpg)](https://www.youtube.com/watch?v=BWjXl4h9_BA)
[演示中使用的壁纸](https://www.youtube.com/watch?v=2pBj0RKN3Y8)

## Hanabi 已迁移到 TypeScript！

> [!IMPORTANT]
> TypeScript 重写版本已经合并到 `main` 分支～ ✨
> 它带来了更好的类型安全性和可维护性，目标平台为 **GNOME 50–51，仅支持 Wayland**。
>
> `javascript` 分支目前处于**维护模式**，适用于 GNOME 45–50——其中的 Bug 仍会被修复，
> 但不会再有新功能了。(・ω・)ノ

## GNOME Shell 支持情况

| 版本   | 42–44    | 45–50        | 50–51  |
| :----: | :------: | :----------: | :----: |
| 状态   | ⚠️       | ✅           | ✅     |
| 分支   | `legacy` | `javascript` | `main` |

## 安装

1. 克隆与你 GNOME Shell 版本对应的分支

- **GNOME 50–51**（TypeScript，仅支持 Wayland）🔥

    ```bash
    git clone https://github.com/jeffshee/gnome-ext-hanabi.git
    ```

- **GNOME 45–50**（JavaScript，支持 X11 和 Wayland）

    ```bash
    git clone https://github.com/jeffshee/gnome-ext-hanabi.git -b javascript
    ```

2. 运行安装脚本

    ```bash
    cd gnome-ext-hanabi
    make install
    ```

    **构建依赖**
    - `main` 分支：`meson`、`ninja`、`node` 和 `npm`
    - `javascript` 分支：`meson` 和 `ninja`
    - 安装时需要 `glib-compile-schemas`（通常由 `libglib2.0-bin` 提供）

3. 重启 GNOME Shell

4. 启用 Hanabi 扩展

5. 在扩展首选项窗口中选择你的视频壁纸

### 各发行版指南

安装说明请参阅[各发行版指南](docs/distro/)。

> 这些指南是为 `javascript` 分支编写的。构建 `main` 分支（GNOME 50–51）时，
> 还需要安装 `ninja`、`node` 和 `npm`。

### 故障排查

1. 视频无法播放 / 扩展已启用但没有任何效果  
   部分发行版（例如 Pop!_OS）没有预装 GTK4 媒体后端。

    安装该后端：

    `sudo apt install libgtk-4-media-gstreamer`

2. 视频播放时 CPU 占用过高（NVIDIA 专有驱动）  
   你的硬件加速可能无法正常工作，请参阅这个 [issue](https://gitlab.freedesktop.org/gstreamer/gst-plugins-bad/-/issues/1478)。

    清除 GStreamer 缓存：

    `rm -rf ~/.cache/gstreamer-1.0/`  
    然后检查 `gst-inspect-1.0 nvcodec` 是否报告了它的全部特性。

3. Blur My Shell —— 壁纸变成半透明  
   如果你使用 [Blur My Shell](https://github.com/aunetx/blur-my-shell) 扩展，并且开启了 **Applications → Applications blur（应用程序模糊）→ Enable all by default（默认全部启用）**，请为 Hanabi 渲染器添加例外。

    在 Blur My Shell 设置中，进入 **Applications → Applications blur → Blacklist（黑名单）**，添加：

    `io.github.jeffshee.HanabiRenderer`

## 高级用法

<details>
<summary>视频后端选择与脚本</summary>

Hanabi 默认使用 GStreamer 的 `gtk4paintablesink` 作为视频输出（sink），它性能良好且兼容性广泛。

你也可以选择使用 [Clapper](https://github.com/Rafostar/clapper) 的 `clappersink`，在 **首选项 → 开发者 → 优先使用 clappersink** 中启用。为此，Clapper 必须通过包管理器安装，而不能使用 Flatpak/Snap 版本。

> 在 GStreamer 1.26+ 的原生安装环境中，`clappersink` 存在一个已知的[兼容性问题](https://github.com/Rafostar/clapper/issues/560)。如果启用该选项后出现崩溃，请将其关闭。

如需更高级的自定义，可以学习如何为 Hanabi 扩展编写脚本！  
详细说明和示例请参阅[脚本指南](docs/scripting.md)。

</details>

## 参与贡献 🚀

欢迎贡献者加入！让我们一起把 Hanabi 扩展做得更好～

### 开发

开发说明请参阅[开发指南](docs/dev.md)。

### 翻译

如果你有兴趣参与翻译，可以在 [Hosted Weblate](https://hosted.weblate.org/projects/gnome-ext-hanabi/gnome-ext-hanabi/) 上提供帮助。

[![Translation status](https://hosted.weblate.org/widget/gnome-ext-hanabi/gnome-ext-hanabi/multi-auto.svg)](https://hosted.weblate.org/engage/gnome-ext-hanabi/)

### 贡献者 ✨

<a href="https://github.com/jeffshee/gnome-ext-hanabi/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=jeffshee/gnome-ext-hanabi" />
</a>

由 [contributors-img](https://contrib.rocks) 生成。  
图标由 [Freepik](http://www.freepik.com/) 制作，来自 [Flaticon](https://www.flaticon.com)。

---

本文档为 [README.md](README.md) 的简体中文翻译。若两者内容不一致，请以英文原版为准。
