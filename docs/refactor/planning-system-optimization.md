# 规划系统优化方案 v3.0

**创建日期**: 2025-01-15
**版本**: 3.0 (聚焦核心优化版)
**状态**: 设计中

## 摘要

### 核心问题
当前系统最主要的问题是**任务表现不稳定**，经常生成无意义或无法完成的任务。根本原因在于Tracker系统过于简单，无法准确判断任务状态。

### 聚焦优化

| 优化项 | 优先级 | 核心价值 | 实施难度 |
|-------|--------|----------|----------|
| 增强Tracker系统 | 最高 | 提升任务完成率30% | 中 |
| 简化为Goal-Task两层 | 高 | 减少架构复杂度 | 中 |
| 历史分析结构化 | 中 | 避免重复失败 | 低 |

### 实施路线图

- **阶段1**: Tracker系统增强 (3周) - 核心优化，提升任务表现
- **阶段2**: 架构简化 (2周) - 移除Plan层，降低复杂度
- **阶段3**: 历史分析结构化 (1周) - 避免重复失败
- **阶段4**: 集成测试和文档 (1周)

**总工期**: 6-7周

---

## 详细优化方案

### 1. Tracker系统增强：支持更丰富的任务类型

#### 当前系统的核心问题

**LLM创建的任务经常不可执行**，根本原因是缺少合适的Tracker类型来表达Minecraft中的复杂任务。

#### Minecraft中的实际任务类型分析

1. **探索类任务**
   - "找到村庄" - 需要在未知区域发现特定结构
   - "找到钻石" - 需要到达特定深度并发现矿石
   - "找到下界传送门" - 需要识别特定建筑

2. **状态类任务**
   - "确保周围安全" - 需要清理敌对生物
   - "获得夜视效果" - 需要特定条件达成
   - "到达地下Y=10" - 位置条件

3. **建造类任务**
   - "建造一个房子" - 需要定义建筑特征
   - "制作农场" - 需要特定元素组合

4. **复合条件任务**
   - "挖到钻石" = 到达Y<15 + 发现钻石矿石 + 采集

#### 新增Tracker类型

**1. RegionTracker - 区域/结构检测**
```typescript
interface RegionTracker {
  type: "region"
  regionType: "village" | "temple" | "fortress" | "mansion" | "monument" | "mineshaft"
  findMode: "any" | "nearest" | "specific"
  scanRadius: number
  targetPosition?: Vec3 // 特定结构的位置
  requiredBlocks?: string[] // 必须包含的方块类型
}

// LLM使用示例
{
  type: "region",
  regionType: "village",
  findMode: "nearest",
  scanRadius: 500
}
```

**2. ExploreTracker - 探索任务**
```typescript
interface ExploreTracker {
  type: "explore"
  target: {
    biome?: string // "desert", "jungle", "nether_wastes"
    structure?: string // "desert_temple", "jungle_temple"
    resource?: string // "diamond_ore", "iron_ore"
    depthRange?: { min: number, max: number } // Y层范围
  }
  strategy: "spiral" | "random" | "systematic"
  maxDistance?: number
  timeLimit?: number // 毫秒
}

// LLM使用示例："挖到钻石"
{
  type: "explore",
  target: {
    resource: "diamond_ore",
    depthRange: { min: 5, max: 15 }
  },
  strategy: "spiral",
  maxDistance: 1000
}
```

**3. ConditionTracker - 条件检测**
```typescript
interface ConditionTracker {
  type: "condition"
  conditions: {
    player?: {
      health?: { min?: number, max?: number }
      hunger?: { min?: number, max?: number }
      effects?: Array<{ type: string, minLevel?: number }>
    }
    environment: {
      position?: { y?: { min?: number, max?: number } }
      biome?: string[]
      dimension?: "overworld" | "nether" | "end"
      lightLevel?: { min?: number, max?: number }
    }
    nearby: {
      entities?: Array<{
        type: string | "hostile" | "passive" | "neutral"
        count?: { min?: number, max?: number }
        distance?: number
      }>
      blocks?: Array<{ type: string, distance?: number, count?: number }>
    }
  }
  checkInterval: number // 检查频率（毫秒）
}

// LLM使用示例："确保周围安全"
{
  type: "condition",
  conditions: {
    nearby: {
      entities: [
        { type: "hostile", count: { max: 0 }, distance: 16 }
      ]
    },
    player: {
      health: { min: 10 }
    }
  },
  checkInterval: 2000
}
```

**4. StructureTracker - 结构验证**
```typescript
interface StructureTracker {
  type: "structure"
  structure: {
    name: string
    // 定义关键特征而非完整结构
    features: StructureFeature[]
    minBlocks?: Array<{ type: string, count: number }>
  }
  checkPosition: Vec3 // 检查中心位置
  radius: number // 检查范围
  tolerance: number // 完成度容忍度 (0-1)
}

interface StructureFeature {
  type: "contains_block" | "has_area" | "has_height" | "count_entities"
  condition: any
}

// LLM使用示例："建造一个简单的房子"
{
  type: "structure",
  structure: {
    name: "simple_house",
    features: [
      {
        type: "has_area",
        condition: { minArea: 9, minHeight: 3 }
      },
      {
        type: "contains_block",
        condition: { block: "oak_door", count: { min: 1 } }
      },
      {
        type: "contains_block",
        condition: { block: "bed", count: { min: 1 } }
      }
    ]
  },
  checkPosition: player.position,
  radius: 20,
  tolerance: 0.7
}
```

**5. EnhancedCollectionTracker - 增强物品收集追踪**
```typescript
interface EnhancedCollectionTracker {
  type: "enhanced_collection"
  target: {
    item: string
    count: number
    // 允许替代品（如不同工具）
    alternatives?: Array<{ item: string, ratio: number }>
    // 考虑耐久度
    durability?: { min?: number }
    // 是否计入耐久物品
    countDamaged?: boolean
  }
  // 检查容器（箱子、熔炉等）
  checkContainers?: boolean
  containerPositions?: Vec3[]
}

// LLM使用示例："获得镐子"
{
  type: "enhanced_inventory",
  target: {
    item: "iron_pickaxe",
    count: 1,
    alternatives: [
      { item: "diamond_pickaxe", ratio: 1 },
      { item: "stone_pickaxe", ratio: 1 }
    ],
    durability: { min: 50 },
    countDamaged: true
  },
  checkContainers: true
}
```

#### 改进的CompositeTracker
```typescript
interface CompositeTracker {
  type: "composite"
  operator: "and" | "or" | "sequence" | "at_least_n"
  trackers: any[]
  weights?: number[] // 各条件权重
}
```

#### 任务创建指南（提供给LLM）

```
创建任务Tracker的原则：

1. 收集类任务：
   - 使用 enhanced_inventory
   - 考虑工具替代方案
   - 示例："获得镐子" → iron_pickaxe 或 diamond_pickaxe

2. 位置/到达任务：
   - 已知位置 → location
   - 未知结构 → explore + region
   - 示例："找到村庄" → explore(target: village)

3. 条件类任务：
   - 使用 condition
   - 明确检查间隔
   - 示例："到地下" → condition(position.y < 50)

4. 建造任务：
   - 使用 structure 定义关键特征
   - 不要定义完整结构
   - 示例："房子" → 门 + 床 + 最小面积

5. 复合任务：
   - 使用 composite 组合多个条件
   - 注意逻辑顺序
   - 示例："挖到钻石" → explore(深度) + condition(位置) + inventory(钻石矿石)
```

#### 实际例子对比

**之前的问题任务**：
```
任务: "建造一个房子"
错误Tracker: {
  type: "inventory",
  item: "house", // 房子不是物品
  targetCount: 1
}
结果: 无法执行
```

**改进后的任务**：
```
任务: "建造一个简单的房子"
正确Tracker: {
  type: "composite",
  operator: "and",
  trackers: [
    {
      type: "structure",
      structure: {
        features: [
          { type: "has_area", condition: { minArea: 9, minHeight: 3 } },
          { type: "contains_block", condition: { block: "door" } }
        ]
      },
      tolerance: 0.6
    },
    {
      type: "condition",
      conditions: {
        nearby: {
          entities: [{ type: "hostile", count: 0, distance: 10 }]
        }
      }
    }
  ]
}
结果: 可执行，任务明确
```

---

### 2. 架构简化：三层变两层

#### 当前问题
Plan层职责单薄，仅作为Task的容器，增加了架构复杂度但没有带来相应价值。

#### 简化方案
```
TaskManager
├── Goal (轻量级标签)
│   └── description: string
│   └── taskIds: string[]
│   └── metadata: Record<string, any>
│
└── Task (一等公民)
    ├── title: string
    ├── description: string
    ├── goalId: string (可选)
    ├── tracker: SmartTracker
    ├── dependencies: TaskDependency[]
    ├── priority: number
    └── context: TaskContext
```

#### 关键变更
- **移除Plan类** - 将其职责合并到Goal和Task
- **增强Task** - 直接包含tracker、依赖、优先级
- **Goal降级** - 仅作为任务分组标签

#### 数据迁移
```typescript
// 迁移脚本示例
function migratePlanToGoal(oldPlan: Plan): Goal {
  const tasks = oldPlan.tasks.map(task => ({
    ...task,
    goalId: oldPlan.goalId, // Task直接关联Goal
    // 保留其他属性
  }))

  return {
    id: oldPlan.goalId,
    description: oldPlan.description,
    taskIds: tasks.map(t => t.id),
    metadata: {
      originalPlanId: oldPlan.id,
      createdAt: oldPlan.createdAt
    }
  }
}
```

---

### 3. 历史分析结构化：避免重复失败

#### 核心思路
不是简单的数据压缩，而是**智能失败模式识别**和**自动改进建议**。

#### 失败模式库
```typescript
const FailurePatterns = {
  RECURSIVE_CRAFT: {
    pattern: "缺少X -> 需要合成X -> 缺少Y -> 需要合成Y -> ...",
    detection: (history) => {
      const chains = history.extractCraftChains()
      return chains.filter(chain => chain.depth > 3).length > 0
    },
    suggestion: "一次性收集所有原材料，避免递归合成"
  },

  UNREACHABLE_LOCATION: {
    pattern: "位置目标被阻挡 -> 重新规划 -> 仍然被阻挡",
    detection: (history) => {
      return history.countAttempts('location_blocked') >= 2
    },
    suggestion: "检查目标位置是否合理，或使用工具改造地形"
  },

  RESOURCE_EXHAUSTION: {
    pattern: "收集任务 -> 资源用完 -> 任务失败",
    detection: (history) => {
      return history.hasResourceConsumptionIssue()
    },
    suggestion: "预估资源需求，准备足够的原材料"
  }
}
```

#### 实时失败检测
```typescript
class FailurePatternDetector {
  analyze(task: Task, history: TaskHistory): FailureAnalysis {
    const issues = []

    // 检测各种失败模式
    for (const [name, pattern] of Object.entries(FailurePatterns)) {
      if (pattern.detection(history)) {
        issues.push({
          type: name,
          description: pattern.pattern,
          suggestion: pattern.suggestion,
          confidence: this.calculateConfidence(name, history)
        })
      }
    }

    return {
      hasPattern: issues.length > 0,
      patterns: issues,
      recommendation: this.getBestSuggestion(issues)
    }
  }

  private getBestSuggestion(issues: FailureIssue[]): string {
    // 根据置信度和影响程度选择最佳建议
    return issues
      .sort((a, b) => b.confidence - a.confidence)[0]
      ?.suggestion || "继续执行当前计划"
  }
}
```

#### 集成到决策循环
```typescript
// 在MainDecisionLoop中集成
const decisionLoop = {
  async execute(): Promise<Decision> {
    // 获取历史分析
    const failureAnalysis = this.failureDetector.analyze(
      this.currentTask,
      this.taskHistory
    )

    // 如果检测到失败模式，提供建议
    if (failureAnalysis.hasPattern) {
      this.logger.warn(`检测到失败模式: ${failureAnalysis.patterns[0].type}`)
      this.logger.info(`建议: ${failureAnalysis.recommendation}`)

      // 可以选择自动调整或提供给LLM
      return this.adjustTaskBasedOnPattern(failureAnalysis)
    }

    // 正常执行
    return await this.makeNormalDecision()
  }
}
```

---

## 实施计划

### 第一阶段：Tracker系统增强（3周）

**任务清单**：
1. 重构Tracker基类，增加CompletionResult返回类型 (3天)
2. 实现SmartCollectionTracker (4天)
3. 实现SmartLocationTracker (4天)
4. 实现SmartCraftTracker (4天)
5. 编写Tracker单元测试 (3天)
6. 性能测试和优化 (2天)

**验收标准**：
- 任务完成率提升30%以上
- Tracker能提供有用的失败原因
- 无明显性能下降

### 第二阶段：架构简化（2周）

**任务清单**：
1. 设计新的TaskManager接口 (2天)
2. 实现Goal-Task迁移逻辑 (3天)
3. 重构GoalPlanningManager为TaskManager (3天)
4. 数据迁移脚本 (1天)
5. 集成测试 (1天)

**验收标准**：
- 代码行数减少30%
- 所有现有功能正常工作
- 通过单元测试

### 第三阶段：历史分析结构化（1周）

**任务清单**：
1. 实现失败模式库 (2天)
2. 实现失败模式检测器 (2天)
3. 集成到决策循环 (2天)
4. 测试和调优 (1天)

**验收标准**：
- 能识别常见的失败模式
- 提供有用的改进建议
- 减少重复失败50%以上

---

## 预期收益

| 指标 | 当前值 | 目标值 | 提升 |
|------|--------|--------|------|
| 任务完成率 | ~60% | ~90% | +50% |
| 无意义任务比例 | ~30% | ~5% | -83% |
| 代码复杂度 | 基准 | -30% | -30% |
| 重复失败率 | 基准 | -50% | -50% |

---

## 结论

本方案聚焦于最核心的问题：**提升任务表现**。通过增强Tracker系统，让系统能够：
1. 准确判断任务状态
2. 提供有用的反馈信息
3. 避免重复失败

这比单纯减少LLM调用更有价值，因为一个能正常工作的系统才能谈优化成本。