# dsh-price-badge

输入框工具行里一个小圆点 + 两个小字，用来一眼判断 **DeepSeek API 现在是高峰（全价）还是低谷（半价）**。

- 绿色 `低谷` = 低谷时段（半价）
- 琥珀色 `高峰` = 高峰时段（全价）
- 灰色 `过期` = 节假日表已覆盖不到当前年份（见下）
- 悬停出原生 tooltip：状态、距离下次切换的倒计时、切换时刻、数据核对日期，以及完整规则

## 位置

注册在 `conversation.input.right`（"Compact controls before the composer submit action"），
也就是输入框卡片**底部工具行**里、模型选择器与发送按钮的左边。

选这里而不是侧栏底部，原因：

- 侧栏最底部那一行就是"设置"，官方只给了设置**上方**的插槽（`sidebar.footer.action`），没有"设置下方"；
- 手机端侧栏是抽屉、默认收起，而输入框工具行始终在屏幕上，桌面和手机是同一个视图，不用两套实现；
- 工具行左侧/右侧都各有一条空插槽（`conversation.input.left` / `.right`），右侧更靠近发送键，视觉上更"贴底"。

副作用：模型正在回复时，工具行会切到 activity 展开态，本插件（和其它 `input.right` 条目一样）暂时隐藏，回复结束自动回来。

## 定价规则（来源：官方 API 文档，2026-11-02 核对）

https://api-docs.deepseek.com/quick_start/pricing

- 高峰：**UTC 01:00–04:00、06:00–10:00**，周一至周五，**不含中国法定节假日**
  （换算北京时间 = 09:00–12:00、14:00–18:00）
- 其余时间全部低谷，价格为高峰的 **50%**；周末与法定节假日全天低谷
- 两个高峰窗口与其 UTC 日期落在同一个北京日，所以按北京日期查节假日是精确的

## 会自己更新吗？——不会

插件**不联网**，规则窗口和节假日表都是 `client.js` 里的常量。兜底设计：

1. `RULE_CHECKED_AT`（当前 `2026-11-02`）会显示在 tooltip 里，随时能看出数据是哪天核对的；
2. 当前北京年份超过节假日表覆盖范围（现在到 2027）时，圆点变灰、文字变 `过期`，
   tooltip 明确写"节假日数据只到 2027，节假日期间可能判错，请更新插件"，不会静默给错答案；
3. 工作日窗口本身不依赖节假日表，所以即使过期，周中高峰/低谷判断仍可用。

更新方法（每年 11 月国务院办公厅发布次年放假安排后做一次，另外官方调价时核对一次）：

- 已挂**会话内定时提醒**（cron `0 10 10 11 *`，Asia/Shanghai，schedule id
  `schedule-c90bb0f3-d5fc-4e5a-bebf-f0a6850d2094`）：每年 11 月 10 日自动提醒核对官方定价页 +
  次年放假安排，并把本文件里的常量更新、跑自检。首次触发 2026-11-10（用来把 2027 年的临时
  数据换成正式通知）。提醒属于当前会话，删掉/归档该会话提醒就没有了。

- 改 `client.js` 里的 `HOLIDAYS`：只写**实际放假的日期区间**（含首尾），不写调休上班日——
  周六日调休上班在定价里仍算周末，本来就是低谷；同时把 `RULE_CHECKED_AT` 改成当天日期；
- 2026 年数据来自国办发明电〔2025〕7号；2027 年目前是 2026-11-02 的媒体口径（**临时**），
  正式通知发布后替换；
- 超出表中年份时不会报错，只按工作日窗口判断并显示"过期"。

如果以后想要"自动发现官方改规则"，需要另外加 Host 侧定时抓官方文档页脚并对窗口做漂移比对
（当前没有做：依赖网页结构，改版就失效，且对每年一次的更新来说收益不大）。

## 文件

| 文件 | 作用 |
|---|---|
| `package.json` | bundle 清单；`dsh.client` 声明 web 端 client 半 |
| `cordis.patch.yml` | 插入 Host 行 `price-badge` |
| `index.js` | Host 半，空实现（渲染全在 client） |
| `client.js` | 时段判定 + 圆点渲染（注册到 `conversation.input.right`） |
| `locale/*.json` | 插件管理页显示的标题/描述 |
| `icon.svg` | 插件图标 |

## 安装与卸载

用 `plugin_manager`（不要手写 profile 的 `package.json` / `cordis.patch.yml`，也不要在 profile 里跑 pnpm）：

- 安装：`action: install_bundle`，`target` = `C:\Users\guolz\Desktop\Self\plugins\dsh-price-badge`
- 停用：`action: set_plugin`，`id: price-badge`，`disabled: true`
- 移除：`action: remove_bundle`

本包是本地目录 link 安装，改 `client.js` 后页面里的 client 模块会重新加载（已实测）；
如果没变化，强刷一次（Ctrl+Shift+R）。替换已安装包的内容有时需要重启才换 JS 模块代。


## 只在 DeepSeek 模型下显示

徽标绑定「当前会话选中的模型」：只有选中的是 DeepSeek 路由（provider id 或 model id 里带
`deepseek`，例如 `deepseek-official` / `deepseek-flash` / `deepseek-v4-pro`）时才显示；
切到小米 MiMo、GLM 等其它提供方时自动隐藏——它们的计费没有峰谷价，显示出来只会误导。

- 检测方式：读 composer 模型按钮里官方渲染的 `<span data-provider-id data-model-id>`，
  不依赖内部服务；模型切换时通过 MutationObserver（250ms 去抖）更新。
- 读不到模型信息时保持显示（退回旧行为），不会因为宿主改版把徽标弄没。
- 已知限制：这是对 DOM 的读取，宿主若改掉 `data-model-id` 属性，会落回「始终显示」。