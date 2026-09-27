# X Feed Pilot

本机单人版：Chrome 扩展在已登录的训练账号上运行有限时长的会话；本地服务调用 Jev、做图片文字 OCR，并把采集结果写入 SQLite；阅读页在另一个浏览器或 Chrome 配置中打开。

## 环境

- macOS、Google Chrome、Node.js 20+、Python 3、Clang 与 Apple Vision 框架
- TypeSafe API key：在项目根目录的 `.env` 中配置 `TYPESAFE_API_KEY`，或使用同名环境变量
- TypeScript 编译器 `tsc`。若未全局安装，先运行 `npm install`。

## 启动

1. 修改 [PREFERENCE.md](PREFERENCE.md) 和 [search-seeds.json](search-seeds.json)。前者在会话开始时固定版本；后者提供低浓度时的一轮搜索词。
2. 复制 `.env.example` 为 `.env` 并填写 `TYPESAFE_API_KEY`，然后在项目目录运行 `npm run build` 和 `npm start`。也可不创建 `.env`，沿用 `TYPESAFE_API_KEY=你的密钥 npm start`。若 `.env` 和环境变量都配置了同一项，优先使用 `.env` 中的非空值。服务只监听 `127.0.0.1:47831`。
3. 在 Chrome 打开 `chrome://extensions`，开启开发者模式，选择“加载已解压的扩展程序”，目录为本项目的 `dist/extension`。
4. 在训练账号的 Chrome 标签页登录 `x.com`；点扩展图标，再点“开始会话”。采集时需让 Chrome 窗口和 X 训练标签页都保持在最前。切到其他 app 或标签页时，采集与 10 分钟计时会暂停；返回训练页后自动继续。开始、停止均由用户手动触发。
5. 在登录另一个 X 账号的浏览器中打开 `http://127.0.0.1:47831/` 查看记录。查看期间训练会暂停。页面调用 X 官方嵌入组件；失败时保留本地文字快照。

停止后重新开始会创建新会话。会话最多 10 分钟或 80 条，最多点赞 8 条、收藏 4 条。服务重新启动会停止上次未结束的会话。历史数据保存在 `data/pilot.sqlite`；此目录已被 Git 忽略。

采集时会先展开帖子的 `Show more` 正文；识别到 `Ad`、`Promoted`、`广告` 或 `推广` 标记的帖子会跳过，不进入 OCR、Jev 或阅读记录。帖子正文中的每个不同网页链接和 @提及账号会分别成为 Jev 可选的访问目标。模型每轮可以选一个未访问目标或结束探索；访问后会把页面文字作为证据再次判断，最多访问 4 次。X 帖子和账号页会在训练浏览器中真实打开；其他网页由本地服务检索公开的文字页面。最终判断决定是否打开原帖、探索作者、点赞或收藏。阅读记录会显示已访问的目标。

扩展无需配对码。更新代码后重新运行 `npm run build`，在 `chrome://extensions` 中重新加载扩展，并重启本机服务。

## 验证

`npm test` 运行编译、OCR 编译及会话决策测试。真实 X 页面仍需在用户已登录的 Chrome 中手工验收，因为其 DOM 和账号状态不可由离线测试代替。

## 约束

Jev 只接收文字；Apple Vision 仅识别图片中的文字。纯视觉图片和无字幕视频若缺少配文，会标记为证据不足。X 官方规则禁止脚本操控网站和自动点赞，使用本工具可能导致训练账号受限；阅读延时不改变这一风险。
