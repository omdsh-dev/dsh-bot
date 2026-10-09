# 架构

中文 | [English](architecture.md)

Bot Mode 是通过 DSH profile patch 在 Web 或 Desktop 中加载的 Host / Client Cordis 插件。Host 在 DSH 的 `bot_mode` 存储域中管理身份、唯一私聊、成员、路由和公开历史；Client 通过原生主面板与侧栏插槽挂载，使用生成的 Remote 编解码。它不启动额外聊天服务器或 SDK 子进程。

每个 Bot 在每个聊天成员关系中拥有独立且持久的原生 Session，作用域系统提示词提供其身份。每次投递都会记录有上限的未读公开消息、可选引用和当前用户请求，不会把私聊记录复制到群聊上下文。明确 @ 优先于引用路由和默认接收者，只有用户发送和重试会触发模型。

公开记录和原生 Session 日志使用不同持久化存储。进程中断时，底层 Turn 可能已完成，而公开回复仍被标为中断。启动不会自动重放不确定的操作；停止会取消该回复，卸载会取消并等待正在执行的任务结束。移除再重新加入成员会创建新的 Session，不删除公开历史。

仓库只保存插件源码和小型集成补丁。补丁增加工作区 TypeScript 路径、编译引用和插件的 pnpm 锁文件条目，不改 Agent 循环、传输、认证或模型实现。安装使用固定的上游提交，保证生成接口与原生插槽有可复现的版本。本插件的按需运行不依赖上游生成的文档目录。

源码分发会准备固定版本的 DSH 工作区用于构建。`npm run pack` 把编译后的实现包装为公共 `@zzzpyyy/dsh-bot` bundle，通过外层 `dsh.bundle.patch` 启用嵌套入口。内部实现保留原 private 包身份，因为生成的 Typert 编解码和 Client 模块注册都引用该身份，不改写生成标识。外层 manifest 将 Host 提供的依赖转为精确版本的 peer dependency，普通依赖单独声明；发布包不包含源码、测试、构建辅助代码或 `workspace:` 范围。

Desktop 与浏览器发现的是同一个 `dsh.client.platform: web` 入口，其 Host 和 Remote 调用使用原生管道及自定义协议，不启动 HTTP 监听。插件没有额外的桌面专用服务器或传输实现。Desktop 管理自己的 profile 和数据。源码 Web 启动器的 `.runtime/` 可以重新构建，`.data/` 保存用户数据，更新时应保留。工具和模型凭据继续由 DSH 管理。

配置、模型可见影响和待实现功能见[插件参考](plugin-reference.zh.md)。Profile 测试会启动两次真实构建的 DSH，仅替换外部模型，检查身份隔离、群聊与私聊上下文、取消、消息订阅顺序和持久化。

安装包测试会解压实际发布的压缩包，调用 Desktop 的真实依赖校验器，并在不启用开发链接豁免的情况下启动原生 Desktop Host，仅替换外部模型。测试通过 `dsh-app://` 请求已注册的 Bot Client 模块，重启 Host 后核对 Session ID，并让同一压缩包通过 Web 认证传输加载。测试资源树不是签名应用包，macOS 窗口交互另行验证；registry 安装仍待 npm 发布后验证。
