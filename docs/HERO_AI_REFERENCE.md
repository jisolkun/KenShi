# 主角普通控制与上传源码的对应关系

这次将上传 `src.rar` 中的普通主角控制规则适配到当前项目。上传项目的主角通过地面输入移动，前方传感器触敌后攻击；没有定时威胁选敌、主动追逐目标或攻击中持续追踪对手。

依据文件：`reference-player-movement.js` 的输入与速度衰减，`reference-control.js` 的连击游标与时钟，`reference-player-state.js` 的动作门控，以及 `combat.js` 的 `updateControlAnimation`、`checkPlayerAttackContacts`、`startAutomaticAttack` 和 `updateSimulation`。附件内文档和注释仅作为分析资料。

`src/referenceHeroControl.js` 提取普通控制决策：近点清除方向，中距离保留方向，远点采样新方向；按住时持续采样，松手后消耗速度因子；以归一化四元数插值转向；攻击开始固定方向；跑/走状态入口恢复攻击传感器；用共享半秒连击时钟决定下一次出招。伤害与翻滚清连击时间，武器切换只重置连击游标。

当前项目有四种武器：三类刀采用原包五式动作、武器路径、伤害和碰撞解算；原创大锤使用独立的三式动作和实物锤头扫掠，普通输入与接敌规则仍由同一控制模块提供。原包的动画层恢复、三秒跑步触发的跳攻、技能、长按蓄力、处决、坐骑和副将没有随普通控制模块直接复制。动作恢复时间由当前武器的现有数据适配。输入距离沿用原包世界单位 `0.625 / 1.0`，传感器沿用当前场景既有换算。

具体替换点：

| 上传包依据 | 当前执行点 | 修复的问题 |
| --- | --- | --- |
| `reference-player-movement.js`、`input.js` | `sampleContinuousHeroInput`、`sampleHeroMovement`、`stepHeroMovement` | 点击落点反复补满速度；按住不拖动时没有输入；中距离保留方向却没有实际移动 |
| `combat.js:startAutomaticAttack` | `heroAttackCandidate`、`beginAttack` | 起手只转向目标角度的 35%；攻击主体继续跟踪目标或移动输入 |
| `combat.js:updateControlAnimation` | `disableHeroSensor`、`setHeroLocomotion` | 部分恢复路径忘记启用传感器，导致后续停砍 |
| `reference-control.js` | `selectHeroAttack`、`stepHeroCombo`、`clearHeroCombo` | 旧 1.8 秒窗口和收招固定递增；受伤、翻滚直接重写招式游标 |
| `reference-player-state.js` | `roll` | 受伤状态可以被翻滚取消；额外的 0.65 秒禁攻 |
| `main.js:physicalMove`、`reference-body-collision.js` | `locomotion` 调用现有 `resolveGreatDaoStep` | 恢复方向惯性穿过活敌人，使敌人落到传感器后方 |

攻击方向门槛恢复为原包的 `2.5` 世界单位，和输入距离采用相同单位；之前将它单独缩至 `1.25`，会拒绝当前场景普通敌人的 `1.55` 停步距离。身体间距沿用当前大刀移动解算的既有尺寸。大刀保留世界脚步锚点至完整末帧显示，随后再接普通移动；翻滚轨迹、击退外力仍沿用当前实现，没有复制整套 Rapier 人物物理。

原包游标初始为 `0`、连击时间初始为 `1`，有效时间内先递增再选招；因此初始化后的第一次普通攻击选第二式。超时后回到第一式。当前五式同样保留这个游标规则，循环长度调整为当前武器的招式数。原创大锤在选择、重置和定位时清连击时间，确保首次从第一击开始，随后按三击循环。

`tests/reference-hero-control.test.js` 验证松手减速、输入迟滞带、跑走阈值、转向、传感器恢复以及五式与半秒窗口。在本次上传包解压目录存在时，额外直接加载原包独立移动函数并比较 500 帧的输入和位移结果；仓库独立运行时，该附件对照检查会跳过，其他行为检查照常执行。

本次历史验证：335 项自动检查、500 帧原包移动对照、19 项生产浏览器检查和最终构建均通过。详细记录见 [验证记录](VALIDATION.md)。
