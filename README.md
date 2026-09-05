# 霓虹砖块 · Neon Breakout

🎮 **在线游玩 / Play Online**：<https://liudongyan13701205717-source.github.io/breakout-neon/>

> 中文文档见下方 ↓ | English below ↓

---

## 中文

### 怎么玩

#### 在线游玩（无需安装）

直接访问：<https://liudongyan13701205717-source.github.io/breakout-neon/>

> 注意：在线版本可以保存进度，但部分浏览器对 github.io 的 localStorage 有限制，建议下载到本地游玩以获得最佳体验。

#### 下载游玩（推荐，进度稳定保存）

1. 点击仓库页面右上角的 **Code** → **Download ZIP**
2. 解压后双击 `index.html` 用浏览器打开即可
3. 所有进度（最高分、成就、霓虹币、存档、自定义地图、每日最佳）保存在本机浏览器中

或者直接下载 ZIP：<https://github.com/liudongyan13701205717-source/breakout-neon/archive/refs/heads/main.zip>

### 游戏内容

- **经典模式**：5 关精心设计的手工关卡，逐关解锁强化
- **无尽模式**：程序化波次，难度永无止境
- **BOSS 突袭**：连续挑战不断强化的巨型砖核（弱点核心、半血狂暴弹幕）
- **每日挑战**：按日期种子生成唯一地图，挑战最高分，奖励霓虹币
- **地图工坊**：画笔绘制自定义地图 / 分享码 / 导入导出，全部离线可用

### 操作

| 按键 / 操作 | 功能 |
| --- | --- |
| `←` `→` 或鼠标 | 移动挡板 |
| `空格` / 点击 | 发射小球 |
| `F` | 发射激光（有冷却） |
| `G` | 能量满时释放超载 |
| `P` | 暂停 |
| `M` | 静音 |
| `Esc` | 返回主菜单 |

### 砖块类型

| 砖块 | 说明 |
| --- | --- |
| 普通 | 一击即碎 |
| 硬砖 | 需多次击碎 |
| 爆炸 | 连锁爆炸周围砖块 + 冲击波特效 |
| 坚壁 | 不可破坏 |
| 相位 | 在实体与虚影间周期性切换 |
| 引力井 | 吸引小球 |
| 再生砖 | 被击碎后一段时间再生 |
| 💎 金币 | 击碎获得霓虹币 |
| ⏱ 时间 | 击碎增加时间奖励 |
| ⚡ 闪电 | 连锁击碎整行砖块 |

### 特性

- **程序化 BGM**：经典/无尽/BOSS 三种音感，WebAudio 实时合成
- **道具**：加宽 / 多球 / 减速 / 双倍 / 穿甲 / 电磁脉冲
- **Roguelike 霓虹协议**：每关随机增益 + 连击倍率
- **元进度**：霓虹币 / 永久升级 / 存档续玩 / 成就系统
- **每日挑战**：按日期种子生成唯一地图，记录本地最佳，奖励霓虹币
- **PERFECT 奖励**：无伤清场额外 +200 分
- **危险区警示**：球接近底部时红色脉冲警示
- **低命心跳**：1 命时暗红 vignette + 心跳音
- **成就通知**：解锁成就、连击里程碑、能量就绪等 Toast 提示
- **视觉特效**：霓虹辉光、拖尾、碎片破碎、命中停顿、震屏、全屏闪光、反弹火花、爆炸冲击波

---

## English

### How to Play

#### Online (no install)

Visit: <https://liudongyan13701205717-source.github.io/breakout-neon/>

> Note: The online version can save progress, but some browsers restrict localStorage on github.io. For the best experience, download and play locally.

#### Download (recommended, stable save)

1. Click **Code** → **Download ZIP** on the repo page
2. Extract and double-click `index.html` to play
3. All progress (high score, achievements, credits, saves, custom maps, daily best) is saved in your browser

Or download ZIP directly: <https://github.com/liudongyan13701205717-source/breakout-neon/archive/refs/heads/main.zip>

### Game Modes

- **Classic**: 5 handcrafted levels with roguelike perk unlocks
- **Endless**: Procedurally generated waves, ever-increasing difficulty
- **Boss Rush**: Face escalating boss cores with weak-point targeting and enrage phases
- **Daily Challenge**: A unique map generated from today's date — compete for the highest score, earn neon credits
- **Map Editor**: Paint your own levels, share via codes, import/export — all offline

### Controls

| Key / Action | Function |
| --- | --- |
| `←` `→` or mouse | Move paddle |
| `Space` / click | Launch ball |
| `F` | Fire laser (has cooldown) |
| `G` | Release overload when energy is full |
| `P` | Pause |
| `M` | Mute |
| `Esc` | Return to menu |

### Brick Types

| Brick | Description |
| --- | --- |
| Normal | Breaks in one hit |
| Hard | Requires multiple hits |
| Explosive | Chain-explodes nearby bricks + shockwave VFX |
| Indestructible | Cannot be destroyed |
| Phase | Cycles between solid and ghost |
| Vortex | Attracts the ball |
| Regen | Regenerates after a short delay |
| 💎 Coin | Drops neon credits when broken |
| ⏱ Time | Adds time bonus to level clear |
| ⚡ Lightning | Chain-breaks entire row of bricks |

### Features

- **Procedural BGM**: Classic / Endless / Boss audio profiles, synthesized live via WebAudio
- **Power-ups**: Wider paddle / Multi-ball / Slow-mo / Double score / Piercing / EMP
- **Roguelike mods**: Random per-level buffs + combo multiplier
- **Meta progression**: Neon credits / Permanent upgrades / Save & continue / Achievements
- **Daily challenge**: Date-seeded unique map, local best record, neon credit rewards
- **PERFECT bonus**: +200 points for clearing a level without taking damage
- **Danger zone warning**: Red pulsing vignette when the ball is near the bottom
- **Low-life heartbeat**: Dark red vignette + heartbeat audio at 1 life
- **Toast notifications**: Achievement unlocks, combo milestones, energy ready alerts
- **Visual FX**: Neon glow, ball trails, debris shards, hit-stop, screen shake, full-screen flash, bounce sparks, explosion shockwaves

### Tech

- Pure HTML / CSS / JavaScript, no build step
- Physics: `matter.min.js` (Matter.js, MIT, bundled)
- Audio: WebAudio API real-time synthesis, no external audio files

### Privacy

No network requests, no data uploaded. All progress (high scores, achievements, credits, saves, custom maps, daily best) stays in your browser's `localStorage`.

---

## 文件 / Files

```
index.html        Page & UI / 页面与 UI
style.css         Styles / 样式
game.js           All game logic / 全部游戏逻辑
matter.min.js     Physics engine (3rd-party, MIT) / 物理引擎（第三方，MIT）
```

## 参与贡献 / Contributing

发现 Bug 或有新想法？欢迎提 Issue / Found a bug or have an idea? Open an Issue:

- 🐛 **Bug 反馈 / Bug report**: Open Issues → New → **Bug 反馈** template
- 💡 **功能建议 / Feature request**: Choose **功能建议** template

提 Issue 前请先搜索是否已有相似问题 / Please search existing issues before creating a new one.
