# ⚠️ 本仓库已迁移 —— 仅作归档，请勿在此提交

解救行动 · OPERATION: RESCUE 现在只保留**一个仓库**：私有仓
[`as8457632/random_rg`](https://github.com/as8457632/random_rg)。
所有版本差异一律用**分支**表达，不再为"发布 / 镜像 / 某次大更新"另开仓库。

| 你要的东西 | 现在在私仓的位置 |
|---|---|
| v5.x 开发主线（当前 v5.3.1） | 分支 `bio-mode` |
| v4.3 冻结线 | 分支 `main` |
| **本仓（v5.x 客户端发布镜像）的完整历史与最终状态** | 分支 `publish/gh-pages-bio` |
| v4.3 老镜像仓的历史 | 分支 `publish/gh-pages-v4.3` |

- 试玩 / 正式入口：<https://lambs.znseed.top/> —— 同源部署，游戏静态与账号 / 云存档 API 由同一个进程（`server/api.js`，监听 28989）提供。GitHub Pages 那份构建因同源解析到自己（`/api` 404）只会退回本地存档、无法登录，属离线镜像。
- 回归门禁：`node test-bio.js`（84 项，含 `[h]` 段用 CDP 派发真实 touch / 键盘 / 鼠标事件的操作链路验证）、`node test-floors.js`（37 项）。
- 镜像发布走 `edgeone makers deploy -n lambs-descent-bio --json`（目录级发布，不依赖本仓）。

本仓库转为**私有**后仅作历史归档保留，后续提交一律去 `random_rg`。
