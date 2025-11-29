# Phaser 3 + Vite + TypeScript Demo

一个最小可运行的 Phaser 3 示例，包含 64×64 Tiled 地图、NPC 对话、语言切换、BGM（首次交互后播放）与 localStorage 存档。

## 开发

```bash
npm install
npm run dev
```

在浏览器打开提示的地址（默认 <http://localhost:5173/site/>）。

## 构建

```bash
npm run build
npm run preview
```

## 要点

- 资源中仅保留 JSON/文本：Tiled 地图与 i18n 字典在 `public` 下，其余占位纹理与 BGM 在 `PreloadScene` 中通过 Canvas 和内嵌数据 URI 生成，无需二进制文件。
- `localStorage` 记录语言、音量与玩家位置等信息。
- 支持键盘方向键/WASD 与触摸点击移动，点击 NPC 显示当前语言的对话。
