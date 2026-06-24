# node-jscs 项目摘要

## 一句话概述
JSCS（JavaScript Code Style）是一个基于 CST（具体语法树）的 JavaScript 代码风格检查与自动修复工具，通过解析源码生成可改写的语法树，再由可配置的规则集合（167 条内置规则）对 token 之间的空白、缩进、操作符间距等风格维度进行校验，并支持基于 token 重写的自动修复。

## 技术栈
- 语言：JavaScript（ES5 风格，prototype 构造，无 class/无 ES module）
- 语法树：`cst` 库（Concrete Syntax Tree，保留空白/注释的可改写语法树，区别于 ESTree AST）
- 遍历：`estraverse`（配合 `cst` 的 visitorKeys）
- 异步：`vow` / `vow-fs`（Promise 实现，用于文件遍历）
- HTML 解析：`htmlparser2`（用于从 HTML 中提取 `<script>` 片段）
- 工具：`lodash`、`minimatch`（excludeFiles glob）、`chalk`（彩色输出）
- 测试：mocha + 167 个规则各自的 fixtures

## 目录结构
```
lib/
├── checker.js              # 入口编排层：文件/目录/stdin 遍历，check/fix/extract 三种模式
├── string-checker.js       # 核心引擎：checkString/fixString，规则调度，错误计算，修复循环
├── js-file.js              # 文件表示：cst.Parser 解析源码，提供 token 导航/查询/改写 API（683 行，最大模块）
├── errors.js               # 错误集合：收集、定位（getPosition 偏移启发式）、过滤、渲染（explainError）
├── token-assert.js         # 断言助手（EventEmitter）：spacesBetween/linesBetween/indentation，emit('error') 带 fix 闭包
├── token-index.js          # Pragma 索引：解析 jscs:enable/disable/ignore 注释，逐 token 计算规则开关 + 缓存 __loc
├── token-categorizer.js    # 括号分类：把 '(' / ')' token 归类为 Statement/Function/CallExpression/分组括号
├── tree-iterator.js        # CST 遍历封装：estraverse + parentCollection 回溯
├── extract-js.js           # HTML 抽取：htmlparser2 提取 <script>，normalizeSource 归一化行偏移
├── cli.js / cli-config.js  # 命令行：加载配置、选 reporter、调度 checker
├── utils.js                # 公共：binaryOperators/unaryOperators 等操作符常量
├── config/
│   ├── configuration.js    # 配置核心（926 行）：规则注册、preset、excludeFiles、maxErrors、fix 开关、errorFilter
│   ├── node-configuration.js # Node 端配置：从 .jscsrc/.jscs.json/package.json 加载
│   └── generator.js        # autoConfigure：扫描现有代码反推推荐配置
├── reporters/              # 9 种输出格式：text/json/checkstyle/junit/unix/inline/inlinesingle/summary
└── rules/                  # 167 条规则，每条：configure/getOptionName/check，可选 _fix
```

## 核心模块与职责
- `lib/string-checker.js` — 引擎心脏。`checkString` 创建 JsFile + Errors，遍历 `_configuredRules` 调 `rule.check(file, errors)`，再建 TokenIndex 计算错误位置与 pragma 过滤。`fixString` 跑最多 5 轮（MAX_FIX_ATTEMPTS）"检查→修复→重新解析"循环。
- `lib/checker.js` — 编排层（继承 StringChecker）。`checkPath`/`fixPath`/`checkStdin` 处理 IO；`extractFile` 把 HTML 内 `<script>` 抽出来分别检查并回加偏移；`_processDirectory` 递归遍历，按 fileExtensions 与 excludeFiles 过滤。
- `lib/js-file.js` — 源码的 CST 封装。构造时用 `cst.Parser` 解析；解析失败则回退为 `Program([Token('EOF','')])` 并记录 _parseErrors。提供 getNextToken/getPreviousToken/getDistanceBetween/setWhitespaceBefore/iterateNodesByType 等约 40 个 token/节点查询与改写方法。
- `lib/token-assert.js` — 规则用的断言原语（继承 EventEmitter）。每个方法（spacesBetween/linesBetween/indentation）检测违例后 `emit('error', {message, element, offset, fix})`，由 Errors 监听收集。`fix` 是闭包，调用时通过 JsFile 的 setWhitespaceBefore 改写 CST。
- `lib/errors.js` — 错误容器。`_addError` 入队；`calculateErrorLocations` 调静态 `Errors.getPosition` 把 element+offset 算成 line/column；`explainError` 渲染带上下行的可视化输出；`stripErrorList` 按 maxErrors 截断。
- `lib/token-index.js` — 注释 pragma 处理。遍历所有 token，识别 `// jscs:enable`/`// jscs:disable`（块作用域）与 `// jscs:ignore`（单行作用域），为每个 token 维护 `{ruleName: bool}` 开关状态；同时把累计的行/列位置缓存到 `token.__loc`。
- `lib/token-categorizer.js` — 把同一个 `(` token 按所属 AST 节点归类（语句括号 if/while/函数定义括号/调用括号/分组括号），供 requireSpacesInConditionalStatement 等规则区分语义。
- `lib/extract-js.js` — 从 HTML 抽取内联 `<script>`：getScripts 用 htmlparser2 定位，normalizeSource 计算并剥离公共缩进（offset），extractJs 汇总每个 script 的 source/offset/line 供 checker 回加错误位置。
- `lib/config/configuration.js` — 配置中枢。registerRule/registerDefaultRules/registerDefaultPresets/load；区分已注册规则、已配置规则、不支持的规则；处理 preset 继承、excludeFiles（minimatch）、maxErrors、fix、errorFilter、fileExtensions、extract 等 BUILTIN_OPTIONS。
- `lib/reporters/text.js` 等输出器 — 遍历 errorsCollection，对非空 Errors 调 `explainError` 渲染（text/json/checkstyle/junit 等格式各异）。

## 数据流 / 调用链
检查流程：
```
cli.js → new Checker() → checker.configure(config)
       → checker.checkPath(path)
       → _processPath → _processDirectory (递归, vow-fs)
       → checkFile(path) → vowFs.read → checkString(source, path)
       → StringChecker.checkString:
           1. new JsFile({source}) → cst.Parser.parse → CST (失败回退 EOF Program)
           2. new Errors(file) → 内部 new TokenAssert(file) 并 on('error') 绑定
           3. 处理 parseErrors（若有则提前返回）
           4. _checkJsFile:
              a. 对每个 _configuredRules: errors.setCurrentRule + rule.check(file, errors)
                 （规则内部用 file.iterateNodesByType + errors.assert.spacesBetween 等）
              b. new TokenIndex(program.getFirstToken())
              c. errors.calculateErrorLocations(tokenIndex) → 每个 error 算 line/column
              d. errors.filter(tokenIndex.isRuleEnabled) → 应用 jscs:enable/disable/ignore
              e. 排序、errorFilter、stripErrorList(maxErrors)
       → 返回 Errors → reporter 输出
```
修复流程（fixString，string-checker.js:276）：
```
attempt = 0
do:
  _checkJsFile(file, errors)              // 填充错误
  _fixJsFile(file, errors):               // 对每个未修复错误
    _fixCommonError: error.fixed=true 先置位 → error.fix()（闭包改写 CST）
       （若 fix 闭包内把 error.fixed=false 则放弃）
    未修复则 _fixSpecificError: rule._fix(file, error)
  若本轮无任何 fixed → break
  file = new JsFile(file.render())        // 重新序列化 + 重新解析
  errors = new Errors(file)               // 重建错误集合（旧错误丢弃）
  attempt++
while attempt < 5
返回 {output: file.getSource(), errors}
```
HTML 抽取流程：`checker.extractFile → extractJs → getScripts(htmlparser2) → normalizeSource(剥离公共缩进) → 逐 script checkString → error.line += script.line; error.column += script.offset` 回加绝对位置。

## 架构模式
- 模板方法：Checker 继承 StringChecker，_processPath/_processDirectory 是骨架，checkFile/fixFile/extractFile 是可替换步骤
- 观察者：TokenAssert extends EventEmitter，规则调 assert.spacesBetween → emit('error') → Errors._addError 监听
- 策略：reporter（9 种输出策略）、rule（167 条独立策略，统一 configure/check 接口）
- 管道：解析 → 规则检查 → 位置计算 → pragma 过滤 → 排序 → maxErrors 截断 → 输出
- 迭代收敛：fixString 的 5 轮修复循环（每轮重新解析）

## 编码惯例
- 全 ES5：prototype 构造函数，`utils.inherits(Sub, Super)` 继承，无 class/箭头函数/let/const
- 规则插件接口固定：`configure(options)`、`getOptionName()`、`check(file, errors)`，可选 `_fix(file, error)`
- 错误通过 `errors.assert.xxx` 或 `errors.add(message, element)` 上报，element 必须是 CST 节点/token
- 位置用 element + offset 表达，由 Errors.getPosition 统一计算（offset 未指定时按元素长度/换行做启发式）
- 异步统一用 vow Promise（非原生 Promise）
- 私有方法/属性以下划线前缀（_checkJsFile、_errorsFound），但仍可被外部访问（如 string-checker 直接读 `file._program`）

## 天然陷阱（供难度设计参考）
1. fixString 每轮重建 `errors = new Errors(file)`（string-checker.js:308），上一轮错误信息全部丢弃，靠 JsFile.render() 重新序列化再解析；若某规则的 fix 引入新的违例，5 轮内可能不收敛，且无任何告警。
2. `_fixCommonError` 在调用 `error.fix()` 之前先 `error.fixed = true`（string-checker.js:108-110），fix 闭包必须主动 `error.fixed = false` 才能放弃——"乐观置位"契约非直觉，规则作者易漏写。
3. token-assert.js 的 spacesBetween/linesBetween 在两 token 间存在注释时静默禁用修复：`fixed = !options.token.getNextNonWhitespaceToken().isComment`（token-assert.js:81, 279），但错误仍会上报——规则依赖自动修复时会出现"报了错却不修"的沉默行为。
4. Errors.getPosition 对规则名硬编码特判：`if (rule === 'validateQuoteMarks') offset = 0`（errors.js:305），其余规则按元素长度/换行数猜 offset，注释里写 "TODO: probably should be generalized"。
5. TokenIndex 处理 `// jscs:ignore` 时先 `index.push(null)` 再向前回溯改写前序 token 的开关（token-index.js:88-98），用 `getNewlineCount() > 0` 判断行边界；ignore 注释位于文件首行时回溯下标可能越界，且单行语义依赖前一 token 是否换行，跨行场景易误判作用范围。
6. checker.extractFile 回加偏移时 `error.column += script.offset`（checker.js:96-97），而 extract-js 的 normalizeSource 剥离的是公共缩进 offset、line 是 script 起始行——这套跨文件的位置还原契约依赖双方字段语义一致，重构任一方都会让 HTML 内嵌脚本错误位置错位。
7. TokenIndex 直接在 cst 库的 token 对象上挂私有属性 `currentToken.__loc = previousLoc`（token-index.js:60），把外部库对象与本模块状态耦合，重复构建索引会覆盖。
8. js-file.js 解析失败回退为 `Program([new Token('EOF','')])`，string-checker 靠 `file._program.firstChild.type === 'EOF'` 判空（string-checker.js:88）——跨模块依赖一个由失败回退产生的 EOF token 作为哨兵，直接读私有 `_program` 与 `firstChild`。
