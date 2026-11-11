# 数量与范围核对台账

日期：2026-11-06。结果由 evidence/analyze.py 从保留证据重算；所有“已验证”仅覆盖本账号、采集时间及列出的样本。

## 1. 计划与任务集合

已验证：计划 8432 条、全部任务 8479 条，双方均无重复 ID，计划全部包含于任务。任务中 category=2 且 is_change=0 的 ID 集合与计划完全相等。分页请求顺序为各17页、每页最多500行，所有页面计数稳定。采集不是服务端事务快照，不保证跨时点永远相同。

证据：[完整投影](evidence/catalog.json)、[集合计算](evidence/analysis-summary.json)。前者记录 projectionFields，保留 ID/范围相关字段及完整响应的序列化摘要；未保留所有大体积工艺字段。

### 47条差异记录

| ID | category | type | is_change | 排产ID | 证据定位 |
|---|---:|---:|---:|---:|---|
| 8087 | 1 | 17 | 0 | 8424 | `catalog.json#/requests/19/data/list/17` |
| 8086 | 1 | 17 | 0 | 8423 | `catalog.json#/requests/19/data/list/18` |
| 7988 | 1 | 17 | 0 | 8318 | `catalog.json#/requests/19/data/list/101` |
| 7962 | 2 | 0 | 1 | 8292 | `catalog.json#/requests/19/data/list/125` |
| 6685 | 1 | 11 | 0 | 6819 | `catalog.json#/requests/21/data/list/280` |
| 6684 | 1 | 13 | 0 | 6818 | `catalog.json#/requests/21/data/list/281` |
| 6683 | 1 | 17 | 0 | 6817 | `catalog.json#/requests/21/data/list/282` |
| 6682 | 1 | 17 | 0 | 6816 | `catalog.json#/requests/21/data/list/283` |
| 6681 | 1 | 17 | 0 | 6815 | `catalog.json#/requests/21/data/list/284` |
| 6389 | 1 | 18 | 0 | 6523 | `catalog.json#/requests/22/data/list/66` |
| 2068 | 1 | 19 | 0 | 2154 | `catalog.json#/requests/30/data/list/154` |
| 143 | 1 | 12 | 0 | 177 | `catalog.json#/requests/33/data/list/398` |
| 142 | 1 | 18 | 0 | 176 | `catalog.json#/requests/33/data/list/399` |
| 141 | 1 | 19 | 0 | 175 | `catalog.json#/requests/33/data/list/400` |
| 108 | 1 | 0 | 0 | 130 | `catalog.json#/requests/33/data/list/422` |
| 107 | 1 | 0 | 0 | 129 | `catalog.json#/requests/33/data/list/423` |
| 103 | 1 | 0 | 0 | 125 | `catalog.json#/requests/33/data/list/425` |
| 102 | 1 | 0 | 0 | 124 | `catalog.json#/requests/33/data/list/426` |
| 101 | 1 | 0 | 0 | 123 | `catalog.json#/requests/33/data/list/427` |
| 98 | 1 | 0 | 0 | 119 | `catalog.json#/requests/33/data/list/428` |
| 96 | 1 | 0 | 0 | 117 | `catalog.json#/requests/33/data/list/429` |
| 93 | 1 | 0 | 0 | 114 | `catalog.json#/requests/33/data/list/430` |
| 87 | 1 | 0 | 0 | 108 | `catalog.json#/requests/33/data/list/434` |
| 86 | 1 | 0 | 0 | 107 | `catalog.json#/requests/33/data/list/435` |
| 83 | 1 | 0 | 0 | 104 | `catalog.json#/requests/33/data/list/437` |
| 67 | 1 | 0 | 0 | 83 | `catalog.json#/requests/33/data/list/444` |
| 65 | 1 | 0 | 0 | 81 | `catalog.json#/requests/33/data/list/445` |
| 47 | 1 | 0 | 0 | 59 | `catalog.json#/requests/33/data/list/454` |
| 46 | 1 | 0 | 0 | 58 | `catalog.json#/requests/33/data/list/455` |
| 45 | 1 | 0 | 0 | 57 | `catalog.json#/requests/33/data/list/456` |
| 44 | 1 | 0 | 0 | 55 | `catalog.json#/requests/33/data/list/457` |
| 37 | 1 | 0 | 0 | 47 | `catalog.json#/requests/33/data/list/458` |
| 30 | 1 | 0 | 0 | 40 | `catalog.json#/requests/33/data/list/463` |
| 28 | 1 | 0 | 0 | 39 | `catalog.json#/requests/33/data/list/464` |
| 27 | 1 | 0 | 0 | 38 | `catalog.json#/requests/33/data/list/465` |
| 25 | 1 | 0 | 0 | 36 | `catalog.json#/requests/33/data/list/466` |
| 24 | 1 | 0 | 0 | 34 | `catalog.json#/requests/33/data/list/467` |
| 22 | 0 | 0 | 0 | 32 | `catalog.json#/requests/33/data/list/468` |
| 21 | 0 | 0 | 0 | 31 | `catalog.json#/requests/33/data/list/469` |
| 15 | 0 | 0 | 0 | 25 | `catalog.json#/requests/33/data/list/471` |
| 14 | 1 | 0 | 0 | 24 | `catalog.json#/requests/33/data/list/472` |
| 13 | 0 | 0 | 0 | 22 | `catalog.json#/requests/33/data/list/473` |
| 11 | 1 | 0 | 0 | 17 | `catalog.json#/requests/33/data/list/474` |
| 9 | 0 | 0 | 0 | 13 | `catalog.json#/requests/33/data/list/475` |
| 6 | 1 | 0 | 0 | 8 | `catalog.json#/requests/33/data/list/476` |
| 3 | 1 | 0 | 0 | 4 | `catalog.json#/requests/33/data/list/477` |
| 1 | 0 | 0 | 0 | 3 | `catalog.json#/requests/33/data/list/478` |

## 2. 发运计数与PDF分组

已验证：三张官方PDF主表各列一个包箱；附表将同编号/规格/长度的多个源成员合并显示。本轮按这三个字段分组可以完整复现三份附表，但未证明这是服务端全部分组键。不得从打印行反推唯一实物身份。

| 发运单 | 包箱 | 列表artifacts_count | 主表数量 | 附表打印行数 | 附表数量和 | API成员记录数 | 分组逐行吻合 |
|---|---|---:|---:|---:|---:|---:|---|
| 8514 | 1622105 | 27 | 1 | 23 | 26 | 26 | True |
| 8513 | 1614199 | 29 | 1 | 28 | 28 | 28 | True |
| 8512 | 1614198 | 33 | 1 | 25 | 32 | 32 | True |

已验证：三个样本满足列表计数=主表包箱数量+成员记录数（27=1+26、29=1+28、33=1+32）。较高可信推断：列表计数包含包箱层和成员层。全局计数算法、散件/多包混合情形仍待验证；不制定统一减1规则。

### 数量大于1的打印分组

| 发运单 | 构件编号 | PDF数量 | 对应源成员ID | GUID数量 |
|---|---|---:|---|---:|
| 8514 | T3-23GL-5 | 4 | 1567717, 1567718, 1567719, 1567720 | 4 |
| 8512 | T2-33GL-22 | 3 | 1576487, 1576488, 1576489 | 3 |
| 8512 | T2-33GL-90 | 6 | 1576557, 1576558, 1576559, 1576560, 1576561, 1576562 | 6 |

完整逐行匹配、GUID与PDF页定位见 [analysis-summary.json](evidence/analysis-summary.json) 的 shippingReconciliation。PDF原字节只在内存使用，保留源URL、时点、SHA-256、脱敏分页文本和裁图。重复下载PDF字节摘要可能因生成时间等变化而不同，不直接判定业务变化。

## 3. 源数量字段抽样

| 资源 | ID | 返回/保存行数 | 数量字段 | 大于1的行数 | 证据 |
|---|---|---:|---|---:|---|
| `/v1.production/getPlanArtifacts` | 8087 | 399/399 | num | 0 | `exceptions.json#/requests/1/data` |
| `/v1.production/getPlanArtifacts` | 7962 | 84/84 | num | 0 | `exceptions.json#/requests/3/data` |
| `/v1.production/getPlanArtifacts` | 6685 | 9/9 | num | 0 | `exceptions.json#/requests/5/data` |
| `/v1.order/getOrderArtifacts` | 8826 | 636/636 | 数量 | 0 | `exceptions.json#/requests/6/data` |
| `/v1.order/getOrderArtifacts` | 8903 | 169/169 | 数量 | 0 | `exceptions.json#/requests/7/data` |
| `/v1.production/getPlanArtifacts` | 22 | 18/18 | num | 0 | `exceptions.json#/requests/9/data` |

已验证：本轮510条生产明细与805条订单明细均为数量1。未找到源行数量大于1的正例；PDF数量4/3/6来自多条源记录聚合，不能当作源批量行证据。此抽样不证明全系统永远每行一件。
