# Compatibility policy / 兼容策略

DSH Bot separates the revision used to **build** from the versions allowed to **run**. One set of Bot `0.8.1`, Feishu `0.4.1` and InfoFlow `0.5.1` archives is tested on DSH `0.1.5-rc.2` and `0.2.0-rc.2`. A routine DSH update does not require a new Bot release.

构建版本固定在 [dsh-version.json](../dsh-version.json)，用于复现编译结果；安装范围集中在 [compatibility.json](../compatibility.json)，不再由构建版本生成精确依赖。三个安装包使用同一份兼容策略。

| 项目 | 策略 |
| --- | --- |
| DSH 及其共享模块 | `>=0.1.5-rc.2 \|\| >=0.2.0-0 \|\| >=0.2.1-0 \|\| >=0.3.0-0`；无上限，允许后续版本尝试加载 |
| Cordis / Schemastery | 分别为 `^4.0.2` / `^3.18.2`，保持已验证的框架主版本 |
| IM 插件依赖的 DSH Bot | `>=0.8.0 <1.0.0`；主包在该范围内保持连接器接口兼容 |
| 已验证的 DSH | `0.1.5-rc.2`、`0.2.0-rc.2` 的固定提交 |

DSH 范围显式列出 0.2.0、0.2.1 和 0.3.0 的预发布基线，普通 npm semver 校验也会接受 `0.2.1-rc.1`。semver 不会自动接受所有未知版本的预发布；增加新的预发布基线时需要更新范围并验证，新版 DSH 启用 includePrerelease 的加载检查不受此限制。允许安装与已验证兼容是不同含义。没有任何机制能够保证未来被删除的模块、改变语义的事件或协议继续兼容。

## 降低需要适配的频率

- Bot 的五个基础图标由插件自带，避免因上游重命名图标导出而导致页面加载失败。
- Host 在打开持久化存储前检查所需方法；Agent 在附加角色和提交消息前检查所需方法；Client 和 IM 入口也检查各自依赖的操作。错误会列出缺少的接口，而不是要求一个精确的 DSH 版本。
- 现有会话、工具和数据仍由 DSH 管理；插件不自行模拟缺失的执行能力，也不关闭 DSH 的正常兼容性检查。
- 方法存在只能检查接口形状；核心模块导出、事件语义和生成的 Remote 协议仍需要真实运行测试。真正的上游破坏性改动仍可能需要一次适配。

最低版本以下不支持。两个版本分别运行通过，不代表可以把新版 DSH 写入的数据交给旧版读取；数据升级及降级规则继续由 DSH 决定。Windows 桌面窗口未验证，测试也不替代飞书/如流企业网络与权限配置。

## 同一安装包的回归矩阵

```sh
npm run setup
npm run pack
npm run pack:feishu
npm run pack:infoflow
node scripts/setup-test-runtime.mjs 0.1.5-rc.2
npm run test:compatibility
```

矩阵不会在不同 DSH 上重新编译插件。它验证压缩包哈希没有变化，并覆盖实际 Desktop/Web Host、前端压缩包与该版本原生控件的交互、单聊/群聊、两个 IM 平台的去重、隔离和重启恢复。外部模型和 IM 传输使用测试替身，不发送真实消息。

DSH 0.2 的统一插件管理器支持本地压缩包，发布前直接验证安装。DSH 0.1 的桌面安装器只支持 npm 版本号，因此发布前验证真实依赖检查和压缩包加载，发布后补充真实 registry 安装：

```sh
DSH_BOT_TEST_VERSION=0.1.5-rc.2 npm run test:registry
DSH_BOT_TEST_VERSION=0.2.0-rc.2 npm run test:registry
```

registry 检查覆盖主包和飞书包；如流 SDK 需要组织授权，CI 只替换该 SDK。GitHub Actions 构建一次，将同一组压缩包交给旧版运行环境测试。增加验证版本只需记录提交并扩展矩阵；只有接口不兼容才需要改插件实现和发布适配版。

源码构建使用 Node 24；发布包另在 Node 22 上运行 Desktop/Web、飞书和如流管理模式测试。CI actions 固定到完整 commit SHA。
