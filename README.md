# Phaser 3 + Vite + TypeScript 进行中的项目

> 目前这个仓库并不是精心完成的演示，而是一个正在构建中的项目——代码中还有许多 TODO，场景/内容需要补充，功能尚未稳定。

## 当前状态

- 依赖已经配置为 Phaser 3 + Vite + TypeScript 的开发环境，`WorldScene` 中有玩家、NPC、对话、导航等基础逻辑。
- `ChunkManager` 可以按需加载 Tiled 区块，碰撞层/对象层会生成基础的碰撞体和 NPC 精灵，但地图资源仍是占位。
- 现有 UI、音乐、持久化机制只是占位示例，BGM 与 `localStorage` 行为需要进一步验证和重构。
- 调试工具（F2~F6）只是临时开关，路径寻路等仍未通过全面测试。

## 快速启动

```bash
npm install
npm run dev
```

运行后在终端提供的网址（默认 `http://localhost:5173/site/`）打开浏览器即可预览，但请注意目前交互十分有限，很多功能都处于草稿阶段。

```bash
npm run build
npm run preview
```

`build` 会先执行 `tsc` 再跑 `vite build`，`preview` 用来检查当前产物；这些命令只是为了校验当前的工程状态，而不是保证上线。

## 待完成工作

1. 替换 `public/assets/maps/` 中的示例地图与 NPC 定位，使 `objects` 图层反映真实内容，完善路径与交互逻辑。
2. 重构 i18n 字典，当前的 `i18n/en.json` / `i18n/zh.json` 仅为样例，缺少统一格式与校验。
3. 把 UI 按钮、语言切换、音量控制等抽象成可复用的组件，避免散落在 `WorldScene` 中的逻辑。
4. 检查 BGM 的解锁流程、音量存储和 `localStorage` 读写，确保刷新后数据可恢复。
5. 补充更多调试信息（例如当前位置、网格状态），并考虑在生产环境自动关闭调试层。
6. 拓展 `ChunkManager` 的加载策略，例如支持多张地图/流式加载更多区块。

## 贡献与协作

- 任何大的变动都应先跑 `npm run build` 验证 TypeScript + Vite 能通过编译。新增依赖记得同步 `package.json` 与 `package-lock.json`。
- 地图数据建议用 Tiled 编辑，导出 JSON 时保持 `ground`/`collision`/`objects` 图层，NPC 对话字段使用 `dialog.en`/`dialog.zh`。
- 如果要更换音频或贴图，更新 `PreloadScene` 中的加载路径并在 `public/assets/` 下放置资源。
- 请把 TODO 或待办项写进 `README` 或新增 ISSUE，让后续人员可快速接手。

## 部署（待确认）

- `vite.config.ts` 目前设置了 `base: '/site/'`，曾打算部署到 GitHub Pages 的 `gh-pages` 分支，但部署流程尚未完全敲定，请在资源和功能稳定后再触发工作流。
- 若需要自定义域名，可在 `public/CNAME` 中提前放置域名，构建时会随静态资源复制；也可以考虑迁移到其他静态托管服务。
