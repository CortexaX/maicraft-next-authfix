# maicraft-next ReAct 规划系统重构方案

**版本**: 1.0  
**日期**: 2024-12-20  
**状态**: 设计完成，待实施

---

## 一、背景与问题

### 1.1 当前系统的问题

**架构问题**：
- Goal-Plan-Task 三层架构过度设计，Plan 层职责不明确
- 代码量大（~3000 行），维护成本高

**决策模式问题**：
- 采用 Plan-and-Execute 模式，而非 ReAct
- 需要 LLM 预先生成完整计划，成功率低
- 偏离 Python 版本的成功模式

**Tracker 系统问题**：
- 只有 4 种基础 Tracker，无法表达复杂任务
- 进度追踪粒度粗，只能判断完成/未完成
- 不满足 MECE 原则（有遗漏、有重叠）

**反馈循环问题**：
- 任务与动作系统脱节，LLM 不知道如何执行
- 定期评估（每 5 次循环）太慢，bot 重复无效动作

### 1.2 重构目标

- **简化架构**：Goal-Task 两层，删除 50% 代码
- **回归 ReAct**：观察 → 思考 → 工具调用 → 观察结果
- **增强 Tracker**：满足 MECE 原则，提供详细进度
- **统一接口**：规划管理作为 Action 提供

---

## 二、设计决策

### 2.1 核心决策记录

#### 决策 1：ReAct vs Plan-and-Execute

**选择**：**ReAct 模式**

**理由**：
- Python 版本已证明 ReAct 有效
- 当前 LLM 能力更适合短期决策
- 反馈循环短，试错成本低

**影响**：
- 去除计划生成系统
- LLM 每次循环直接决策动作
- 任务清单作为"提示"而非"指令"

---

#### 决策 2：Goal-Task 两层架构

**选择**：**两层（去除 Plan 层）**

**理由**：
- Plan 层只是 Task 容器，没有独立职责
- 两层更符合 LLM 理解

**设计**：
```
Goal（目标）
- 特征：抽象、可能需要多步骤
- 示例："找到村庄"、"挖到钻石"
- Tracker：可选

Task（任务）
- 特征：具体、可用单一动作完成
- 示例："收集 20 个橡木原木"
- Tracker：推荐
- 归属：必须属于某个 Goal
```

**区分标准**（提供给 LLM）：
1. 能用一个动作完成？→ Task，否则 → Goal
2. 有明确完成标准？→ Task，否则 → Goal
3. 查看动作列表，能直接对应？→ Task，否则 → Goal

---

#### 决策 3：统一的规划管理接口

**选择**：**plan_action（统一工具）**

**理由**：
- 目标和任务结构相似，参数基本一致
- 统一接口减少 LLM 学习成本

**参数设计**：
```typescript
{
  type: 'goal' | 'task',           // 区分目标/任务
  operation: 'add' | 'edit' | 'remove' | 'complete',
  id?: string,                      // 语义化ID（add时可选）
  content?: string,                 // 描述
  goalId?: string,                  // 所属目标（仅task的add需要）
  tracker?: TrackerConfig,          // 可选的自动检测
  priority?: number                 // 1-5，默认3
}
```

---

#### 决策 4：Tracker 可选 + 双模式完成

**选择**：**自动检测与手动标记并存**

**理由**：
- 有些任务无法用 Tracker（如"建造漂亮的房子"）
- 有些任务能精确追踪（如"收集 20 个木材"）

**工作机制**：
```
自动模式（后台每次循环）：
- 有 Tracker 的目标/任务自动检测
- 完成时标记 completedBy: 'tracker'

手动模式（LLM 主动）：
- 无 Tracker 或复杂条件
- LLM 调用 plan_action complete
- 标记 completedBy: 'llm'
```

---

#### 决策 5：语义化 ID

**选择**：**使用语义化 ID 而非 UUID**

**理由**：
- LLM 更容易理解和引用
- 方便调试和日志查看
- 表达归属关系

**生成规则**：
```
Goal: 关键词下划线连接
  "找到村庄" → "find_village"

Task: goalId + "_" + 关键词
  goalId="find_village", "向东探索" → "find_village_explore_east"

冲突: 添加数字后缀
  "find_village_2"
```

---

#### 决策 6：任务是提示性的

**问题**：如何保证任务可以用现有动作完成？

**选择**：**不强制对应，任务作为提示**

**理由**：
- 无法强制一一对应（会限制创造力）
- 任务可以是"持续提醒"
- LLM 用动作组合完成任务

**辅助策略**：
- Prompt 中提供动作列表（简洁版）
- 强调"能用一个动作完成的才是任务"

---

### 2.2 目录结构

```
src/core/agent/planning/
├── goal/
│   ├── Goal.ts              # 数据结构 + 类型定义
│   └── GoalManager.ts       # 管理器：增删改查、自动检测、格式化
├── task/
│   ├── Task.ts              # 数据结构 + 类型定义
│   └── TaskManager.ts       # 管理器：增删改查、自动检测、格式化
└── trackers/                # 保留现有位置
    ├── types.ts             # Tracker 接口和进度类型
    ├── InventoryTracker.ts  # 重新设计
    ├── LocationTracker.ts   # 重新设计
    ├── EntityTracker.ts     # 新增
    ├── EnvironmentTracker.ts # 新增
    ├── CraftTracker.ts      # 增强
    ├── CompositeTracker.ts  # 增强
    └── TrackerFactory.ts    # 工厂（支持序列化）

src/core/actions/implementations/
└── PlanAction.ts            # 规划管理动作
```

---

## 三、架构设计

### 3.1 整体架构图

```
┌─────────────────────────────────────────────┐
│          MainDecisionLoop (ReAct)           │
│                                             │
│  观察 → 思考 → 工具调用 → 观察结果 → ...   │
└─────────────────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
   ┌────▼────┐           ┌─────▼─────┐
   │ Planning │           │   Action  │
   │  System  │           │  System   │
   └────┬────┘           └─────┬─────┘
        │                       │
┌───────┴────────┐      ┌──────┴────────┐
│ GoalManager    │      │ plan_action   │
│ TaskManager    │      │ mine_by_type  │
│ TrackerSystem  │      │ craft         │
│                │      │ ...           │
└────────────────┘      └───────────────┘
```

### 3.2 ReAct 循环流程

```
┌──────────────────────────────────────┐
│ 1. 自动检测（后台，每次循环）        │
│    goalManager.checkCompletion()     │
│    taskManager.checkCompletion()     │
└─────────────┬────────────────────────┘
              │
┌─────────────▼────────────────────────┐
│ 2. 收集状态                          │
│    - GameState                       │
│    - 当前目标和任务列表（格式化）    │
│    - 最近的思考和动作结果            │
└─────────────┬────────────────────────┘
              │
┌─────────────▼────────────────────────┐
│ 3. 构建 Prompt                       │
│    - 当前目标: formatGoals()         │
│    - 任务清单: formatTasks()         │
│    - 可用动作列表（简洁版）          │
│    - 最近反馈                        │
└─────────────┬────────────────────────┘
              │
┌─────────────▼────────────────────────┐
│ 4. LLM 决策（Tool Calling）          │
│    可能调用多个工具：                │
│    - plan_action（管理）             │
│    - mine/craft/move（执行）         │
└─────────────┬────────────────────────┘
              │
┌─────────────▼────────────────────────┐
│ 5. 执行工具 + 收集结果               │
└─────────────┬────────────────────────┘
              │
┌─────────────▼────────────────────────┐
│ 6. 记录反馈到记忆                    │
└──────────────────────────────────────┘
              │
              └──► 回到步骤 1
```

---

## 四、核心组件接口

### 4.1 数据结构

#### Goal（目标）

```typescript
interface Goal {
  id: string;              // 语义化ID
  content: string;         // 描述
  tracker?: Tracker;       // 可选的自动检测
  status: 'active' | 'completed' | 'abandoned';
  priority: number;        // 1-5
  createdAt: number;
  completedAt?: number;
  completedBy?: 'tracker' | 'llm';  // 记录完成方式
  metadata: Record<string, any>;
}
```

#### Task（任务）

```typescript
interface Task {
  id: string;              // 语义化ID
  content: string;         // 描述
  goalId: string;          // 所属目标（必需）
  tracker?: Tracker;       // 可选的自动检测
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: number;        // 1-5
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  completedBy?: 'tracker' | 'llm';
  metadata: Record<string, any>;
}
```

---

### 4.2 Tracker 系统设计

#### Tracker 分类（MECE 原则）

```
Tracker (基类)
│
├── StateTracker（状态型 - 检查状态是否达成）
│   ├── InventoryTracker      # 背包物品状态
│   ├── LocationTracker        # 位置状态
│   ├── EntityTracker          # 实体状态（新增）
│   └── EnvironmentTracker     # 环境状态（新增）
│
├── ActionTracker（动作型 - 检查是否执行了动作）
│   └── CraftTracker           # 制作动作
│
└── CompositeTracker（组合型 - 组合多个 Tracker）
    └── logic: 'and' | 'or' | 'sequence'
```

**MECE 分析**：
- **Mutually Exclusive**（互斥）：状态型 vs 动作型，清晰区分
- **Collectively Exhaustive**（完备）：
  - 状态型：背包、位置、实体、环境（覆盖游戏世界的主要状态）
  - 动作型：制作（可扩展：使用、击杀等）
  - 组合型：处理复杂条件

#### Tracker 接口

```typescript
// 进度信息
interface TrackerProgress {
  current: number;         // 当前进度值
  target: number;          // 目标值
  percentage: number;      // 百分比 0-100
  description: string;     // 如 "15/20 oak_log"
  details?: any;           // 额外细节
}

// Tracker 基类
interface Tracker {
  type: string;
  
  // 检查是否完成
  checkCompletion(context: GameContext): boolean;
  
  // 获取进度（关键：提供详细进度）
  getProgress(context: GameContext): TrackerProgress;
  
  // 获取描述
  getDescription(): string;
  
  // 序列化
  toJSON(): any;
}
```

#### 新增 Tracker 类型

**EntityTracker** - 实体追踪（解决"找到村民"等任务）：
```typescript
interface EntityTrackerConfig {
  entityType?: string;     // 如 'villager'
  entityCategory?: 'hostile' | 'passive' | 'neutral' | 'player';
  minCount?: number;       // 最小数量
  maxCount?: number;       // 最大数量
  distance?: number;       // 检测距离，默认 16
  mustSee?: boolean;       // 是否必须可见
}

// 使用示例
{type: "entity", entityType: "villager", minCount: 1, distance: 32}
```

**EnvironmentTracker** - 环境追踪（解决"等待白天"等任务）：
```typescript
interface EnvironmentTrackerConfig {
  timeOfDay?: {min?: number, max?: number};  // 0-24000
  weather?: 'clear' | 'rain' | 'thunder';
  biome?: string;
  dimension?: 'overworld' | 'nether' | 'end';
  lightLevel?: {min?: number, max?: number};
}

// 使用示例
{type: "environment", timeOfDay: {min: 0, max: 12000}}  // 白天
```

#### 增强的 CompositeTracker

```typescript
interface CompositeTrackerConfig {
  logic: 'and' | 'or' | 'sequence';
  trackers: Tracker[];
  weights?: number[];      // 各条件权重（用于进度计算）
}

// sequence 模式：必须按顺序完成
// 示例：制作铁镐的完整流程
{
  type: "composite",
  logic: "sequence",
  trackers: [
    {type: "inventory", itemName: "oak_log", targetCount: 4},
    {type: "craft", itemName: "crafting_table", targetCount: 1},
    {type: "inventory", itemName: "cobblestone", targetCount: 20},
    // ...
  ]
}
```

---

### 4.3 Manager 接口

#### GoalManager

```typescript
class GoalManager {
  // 核心方法
  addGoal(params): Goal;              // 添加目标
  updateGoal(id, updates): void;      // 更新目标
  removeGoal(id): void;               // 删除目标
  completeGoal(id, completedBy): void;// 完成目标
  
  // 自动检测（后台调用）
  checkCompletion(context): void;     // 检测所有活动目标
  
  // 查询
  getCurrentGoal(): Goal | null;      // 获取当前目标
  getActiveGoals(): Goal[];           // 获取所有活动目标
  
  // 格式化（用于 Prompt）
  formatGoals(context?): string;      // 格式化显示
  // 输出示例：
  // 🎯 [find_village] 找到村庄
  // 📌 [get_diamond] 挖到钻石 (0/1 钻石)
  
  // 持久化
  toJSON(): any;
  static fromJSON(json): GoalManager;
  
  // 私有方法
  private generateId(content): string;        // 生成语义化ID
  private ensureUniqueId(baseId): string;     // 确保ID唯一
}
```

#### TaskManager

```typescript
class TaskManager {
  // 核心方法
  addTask(params): Task;              // 添加任务
  updateTask(id, updates): void;      // 更新任务
  removeTask(id): void;               // 删除任务
  completeTask(id, completedBy): void;// 完成任务
  
  // 自动检测
  checkCompletion(context): void;     // 检测所有未完成任务
  
  // 查询
  getTasksByGoal(goalId): Task[];     // 获取目标的任务
  
  // 格式化（用于 Prompt）
  formatTasks(goalId?, context?): string;
  // 输出示例：
  // ✅ [task_1] 收集20个木材 (20/20)
  // 🔄 [task_2] 制作工作台
  // ⏳ [task_3] 收集圆石 (5/20)
  
  // 持久化
  toJSON(): any;
  static fromJSON(json): TaskManager;
}
```

---

### 4.4 PlanAction 接口

```typescript
class PlanAction extends BaseAction<PlanActionParams> {
  readonly id = ActionIds.PLAN_ACTION;
  readonly name = 'PlanAction';
  readonly description = '管理目标和任务的规划';
  
  // 执行方法
  async execute(context, params): Promise<ActionResult> {
    // 根据 type 分发
    if (params.type === 'goal') {
      return this.handleGoal(context, params);
    } else {
      return this.handleTask(context, params);
    }
  }
  
  // 参数 Schema（提供给 LLM）
  getParamsSchema(): any {
    return {
      type: {enum: ['goal', 'task'], required: true},
      operation: {enum: ['add', 'edit', 'remove', 'complete'], required: true},
      id: {type: 'string', pattern: '^[a-z][a-z0-9_]*$'},
      content: {type: 'string'},
      goalId: {type: 'string'},  // 仅 task 的 add 需要
      tracker: {type: 'object', properties: {
        type: {enum: ['inventory', 'location', 'entity', 'environment', 'craft', 'composite']},
        // ... 各 Tracker 的具体参数
      }},
      priority: {type: 'number', min: 1, max: 5}
    };
  }
  
  // 私有方法
  private handleGoal(context, params): Promise<ActionResult>;
  private handleTask(context, params): Promise<ActionResult>;
}
```

---

## 五、Prompt 设计要点

### 5.1 系统提示词要点

```
# 规划原则

## 目标 vs 任务的区分

判断流程：
1. 查看可用动作列表
2. 能用一个动作完成？ 能→Task，否→Goal
3. 有明确完成标准？ 有→Task，否→Goal

示例：
✅ Goal: "找到村庄"（需要探索、识别）
✅ Task: "收集20个木材"（mine_by_type）
❌ Goal: "收集木材"（太具体，应该是Task）
❌ Task: "变强"（太抽象，应该是Goal）

## 可用动作列表（简洁版）

执行类：
- mine_by_type: 挖掘方块
- craft: 合成物品
- move: 移动到坐标
- move_to_block: 移动到方块附近
- place_block: 放置方块
- open_chest_gui: 打开箱子
- kill_mob: 击杀生物
- ... (共15个)

管理类：
- plan_action: 管理目标和任务

## Tracker 类型说明

可以为目标/任务设置 tracker 自动检测：
1. inventory: 背包物品 {itemName, targetCount}
2. location: 位置 {x, y, z, radius}
3. entity: 实体 {entityType, minCount, distance}
4. environment: 环境 {timeOfDay, weather, biome}
5. craft: 制作 {itemName, targetCount}
6. composite: 组合 {logic, trackers}

## 行为准则

1. 接到新需求时：
   - 先创建目标（plan_action type=goal）
   - 分析需要的步骤
   - 创建任务（plan_action type=task）
   - 尽量设置 tracker

2. 执行任务：
   - 查看任务清单，选择优先级高的
   - 用对应动作执行
   - 观察结果，调整策略

3. 任务管理：
   - 完成任务后及时标记（如果没有 tracker）
   - 保持清单整洁
```

### 5.2 用户提示词要点

```
# 当前规划

当前目标：
{{formatGoals}}

任务清单：
{{formatTasks}}

{{goal_completed_hint}}

# 最近的思考和行动

{{recent_thoughts}}
{{recent_action_results}}

# 当前状态

位置: {{position}}
背包: {{inventory}}
生命值: {{health}}
环境: {{nearby_blocks}}
实体: {{nearby_entities}}

# 决策要求

请根据当前状态决策下一步行动（可调用多个工具）。
```

---

## 六、实施路线

### 6.1 删除旧系统

**删除文件**：
- `src/core/agent/planning/Plan.ts`
- `src/core/agent/planning/Task.ts`（旧版）
- `src/core/agent/planning/TaskHistory.ts`
- `src/core/agent/planning/GoalPlanningManager.ts`

**删除 Prompt**：
- `data/prompts/plan-generation-system.txt`
- `data/prompts/task-evaluation-system.txt`

**删除功能**：
- `generatePlanForCurrentGoal()` 方法
- `handleTaskEvaluation()` 方法
- 定期任务评估逻辑

---

### 6.2 创建新系统

**新建文件**（按顺序）：
1. `src/core/agent/planning/goal/Goal.ts` - 数据结构
2. `src/core/agent/planning/goal/GoalManager.ts` - 管理器
3. `src/core/agent/planning/task/Task.ts` - 数据结构
4. `src/core/agent/planning/task/TaskManager.ts` - 管理器
5. `src/core/agent/planning/trackers/types.ts` - Tracker 接口
6. 重新实现各个 Tracker
7. `src/core/actions/implementations/PlanAction.ts` - 规划动作

**实施注意事项**：
- Tracker 保留现有实现作为基础，增强而非重写
- TrackerFactory 需要更新以支持新 Tracker
- 每个 Tracker 都要实现 `getProgress()` 方法

---

### 6.3 改造主循环

**MainDecisionLoop 修改**：

```typescript
class MainDecisionLoop {
  // 添加字段
  private goalManager: GoalManager;
  private taskManager: TaskManager;
  
  async runIteration() {
    // 1. 自动检测（每次循环）
    this.goalManager.checkCompletion(this.context);
    this.taskManager.checkCompletion(this.context);
    
    // 2. 收集状态
    const state = await this.collectState();
    
    // 3. 构建 Prompt
    const prompt = this.buildPromptWithPlanning(state);
    
    // 4-6. LLM 决策、执行、记录（保持不变）
    // ...
  }
  
  private buildPromptWithPlanning(state): string {
    const currentGoal = this.goalManager.getCurrentGoal();
    
    return promptManager.generatePrompt('main_thinking', {
      ...state,
      current_goal: this.goalManager.formatGoals(this.context),
      task_list: currentGoal 
        ? this.taskManager.formatTasks(currentGoal.id, this.context)
        : '没有当前目标',
      goal_completed_hint: !currentGoal 
        ? '\n💡 提示：当前目标已完成，你可以设定新的目标继续冒险'
        : ''
    });
  }
}
```

**删除**：
- `checkAndGeneratePlan()` 方法
- `evaluateTask()` 方法
- 定期评估的计数器

---

### 6.4 更新 Prompt

**main-thinking-system.txt**：
- 添加"规划原则"章节
- 添加"目标 vs 任务"区分标准
- 添加简洁的动作列表
- 添加 Tracker 类型说明
- 删除计划生成相关内容

**main-thinking.txt**：
- 修改变量名：`to_do_list` → `task_list`
- 添加 `goal_completed_hint` 变量
- 强调使用 `plan_action` 管理任务

---

### 6.5 数据持久化

**数据文件**：
- `data/goals.json` - 目标数据
- `data/tasks.json` - 任务数据

**迁移脚本**（可选）：
```typescript
// scripts/migrate-planning-data.ts
// 将 goal-planning.json 转换为新格式
// 提取 goals → goals.json
// 提取 plans 中的 tasks → tasks.json
```

---

### 6.6 实施时间估算

| 任务 | 时间 | 说明 |
|------|------|------|
| 1. 删除旧系统 | 0.5天 | 删除文件和代码 |
| 2. 创建新数据结构 | 1天 | Goal/Task 结构和类型 |
| 3. 实现 GoalManager | 1.5天 | 核心管理逻辑 |
| 4. 实现 TaskManager | 1.5天 | 核心管理逻辑 |
| 5. 重新设计 Tracker | 3天 | 5个Tracker + Factory |
| 6. 实现 PlanAction | 1天 | Action实现和注册 |
| 7. 改造主循环 | 1.5天 | 集成新系统 |
| 8. 更新 Prompt | 1天 | 两个Prompt文件 |
| 9. 测试和调试 | 2天 | 单元测试和集成测试 |
| **总计** | **13天** | |

---

## 七、预期效果

### 7.1 代码指标

- **代码量**：从 ~3000 行减少到 ~1500 行（-50%）
- **文件数**：从 10+ 个减少到 7 个核心文件
- **复杂度**：去除三层嵌套，简化为两层

### 7.2 功能指标

- **Tracker 类型**：从 4 种增加到 7 种（满足 MECE）
- **进度追踪**：从"完成/未完成"二值到详细百分比
- **任务表达**：覆盖率从 ~60% 提升到 ~90%

### 7.3 性能指标

- **反馈循环**：从 5 次循环缩短到每次循环
- **LLM 调用**：减少计划生成和评估调用
- **决策准确度**：预期提升 30%

### 7.4 使用流程示例

```
1. 启动：用户配置初始目标 "挖到钻石"
   ↓
2. Bot 创建目标
   plan_action({type: "goal", operation: "add", id: "get_diamond", content: "挖到钻石"})
   ↓
3. Bot 分解任务
   plan_action({type: "task", ..., content: "收集20个木材", tracker: {...}})
   plan_action({type: "task", ..., content: "制作工作台"})
   plan_action({type: "task", ..., content: "收集圆石", tracker: {...}})
   ...
   ↓
4. ReAct 循环
   观察：任务清单、环境状态
   思考：选择优先级高的任务
   行动：mine_by_type("oak_log", 20)
   结果：成功挖掘 15 个，还需 5 个
   ↓
5. Tracker 自动检测
   系统："✅ 任务自动完成：收集20个木材"
   ↓
6. 继续执行其他任务...
   ↓
7. 目标完成
   系统："🎯 目标完成：挖到钻石"
   Prompt："💡 提示：当前目标已完成，你可以设定新的目标"
   ↓
8. Bot 设定新目标
   plan_action({type: "goal", ..., content: "探索下界"})
   ↓
9. 继续循环...
```

---

## 八、关键设计要点总结

### 8.1 设计哲学

**从"预先规划"到"即时反应"**：
- 旧：LLM 生成完整计划 → 按计划执行 → 定期评估
- 新：LLM 观察状态 → 决策下一步 → 立即反馈

**从"强制对应"到"灵活引导"**：
- 旧：任务必须对应某个 Tracker
- 新：Tracker 辅助，LLM 自主判断

**从"复杂嵌套"到"扁平清晰"**：
- 旧：Goal → Plan → Task
- 新：Goal → Task

### 8.2 关键创新点

1. **统一规划接口**：目标和任务通过一个 Action 管理
2. **双模式完成**：自动检测 + 手动标记并存
3. **MECE Tracker**：覆盖完整、互不重叠
4. **详细进度**：每个 Tracker 提供百分比进度
5. **语义化 ID**：LLM 友好的标识符

### 8.3 注意事项

**开发时**：
- Tracker 要考虑边界情况（如实体消失、环境变化）
- Manager 要处理 ID 冲突
- PlanAction 要验证参数完整性

**测试时**：
- 测试各种 Tracker 组合
- 测试自动检测的时机
- 测试 LLM 理解语义化 ID

**部署时**：
- 备份现有数据
- 提供数据迁移工具
- 保留旧系统一段时间作为对比

---

**方案完成，可以开始实施。**
