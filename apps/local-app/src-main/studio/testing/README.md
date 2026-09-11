# 测试支持目录

测试源码继续与被测源码相邻；本目录只保存跨测试复用的夹具，不保存业务测试集合。

```text
testing/
└─ graph/
   ├─ causal-region-harness.ts  真实 Kernel + 局部 Node 组装、submission 与 Trace
   └─ info-collector.ts         区域边界 Info 收集 Node
```

规则：

- 纯算法测试不使用 Kernel；
- Node/局部链测试使用真实生产 Node，只替换 EffectAdapter；
- Collector 只记录边界 Info，不复制生产 Owner 状态机；
- 测试必须显式列出挂载 Node，不自动装配完整 Studio Graph；
- Kernel 自身测试直接使用底层 API，不经过应用测试 Harness。
