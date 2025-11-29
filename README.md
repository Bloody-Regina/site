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

## CI / Pages

- 首次部署后，站点将发布到 `gh-pages` 分支根目录，对应 URL 形式为 `https://<你的 GitHub 用户名>.github.io/site/`（Vite `base` 已固定为 `/site/`）。
- 部署工作流：在 Actions 中选择 **Deploy to GitHub Pages**，点击 **Run workflow** 可手动触发；推送到 `main` 也会自动部署。
- 若需自定义域名，请在仓库中添加 `CNAME`（如放在 `public/CNAME` 以便随构建发布）。

## 要点

- 资源以 JSON/文本为主：Tiled 地图与 i18n 字典在 `public` 下，tileset/NPC 占位纹理通过 Canvas 生成，BGM 改为加载本地 `public/assets/audio/串烧.mp3`。
- `public/assets/maps/chunk_0_0.json` 为 64×64 Tiled 地图占位，含地表/碰撞/对象层和 NPC 对话字段，可直接替换为你本地导出的真实地图（保持 JSON 文本）。
- 若要更换曲目，替换 `public/assets/audio/` 下的 MP3/OGG 文件并在 `PreloadScene` 中调整路径即可。
- `localStorage` 记录语言、音量与玩家位置等信息。
- 支持键盘方向键/WASD 与触摸点击移动，点击 NPC 显示当前语言的对话。
