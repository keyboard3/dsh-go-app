# 开发者与进阶使用

日常使用见[首页](../README.md)。本文保留构建环境、插件内部流程、源码安装和案例实现的技术说明。

## 环境与版本

原安装说明对应 DSH Go 1.0.13 的本机引擎，DeepSeek Harness `0.2.2-rc.1`，Node.js 24.9 或更新版本。其他设备与环境需要由 Agent 检查实际可用性。初始化本机引擎可参考 [DSH Go 主机与安装指南](https://github.com/ccch1mneyyy/dsh-Go/blob/v1.0.13/docs/plugins/hosts.md)。

## 配置构建环境

DSH Go 的 ARM64 PRoot 环境如果使用 glibc 2.38 或更新版本，可以在第一次确认构建时自动配置。请使用能显示审批提示的会话权限，例如「工作区内修改」。确认框会提示下载缺少的工具并接受 [Android SDK 许可](https://developer.android.com/studio/terms)。

插件会复用已有的 JDK 和 SDK，从固定的上游地址补齐缺少的组件。空环境首次下载约 330 MB。安装前验证下载大小和 SHA-256，试编译并验证一个临时 APK 后保存配置。以后构建复用已配置的工具。[工具链清单](../lib/toolchain-sources.json)

也可以在 DSH Go 终端提前配置。默认 DSH Home 是 `~/.dsh`，如果你的安装位置不同，请调整 `PLUGIN`。

```sh
PLUGIN="${DSH_HOME:-$HOME/.dsh}/profiles/web/node_modules/dsh-go-android-app"
node "$PLUGIN/bin/dsh-go-android-app.js" setup --accept-android-sdk-license
node "$PLUGIN/bin/dsh-go-android-app.js" doctor
```

已有工具链时，可用 `configure` 指定实际路径。需要 JDK 17 或更新版本、Android API 34 的 `android.jar`、本机架构的 `aapt2` 和 `zipalign`，以及 `d8.jar` 和 `apksigner.jar`。

```sh
node "$PLUGIN/bin/dsh-go-android-app.js" configure \
  /path/to/jdk /path/to/build-tools-bin /path/to/android.jar /path/to/tool-jars
```

标准桌面 SDK 布局也可通过 `JAVA_HOME` 和 `ANDROID_HOME` 定位 Build Tools 34.0.0 及 API 34。配置和本地签名密钥保存在 `~/.local/share/dsh-go-app/`，可用 `DSH_GO_APP_HOME` 指定目录。

## 查阅 Android API

`dsh_app_android_docs` 先从 `developer.android.com` 读取 API 参考。访问失败或正文缺少目标声明时，再尝试 `developer.android.google.cn` 的同路径和锚点，并返回实际来源。为插件项目传入 `projectId`，可以用当前构建 SDK 的 `android.jar` 核对平台 API 签名。AndroidX 用法按项目解析出的依赖版本核对，权限和运行条件查对应的官方文档。

## 插件工作流

1. Harness 先用 `dsh_app_doctor` 检查所需能力，再创建 `dsh-apps/<项目 ID>/`，生成 `index.html` 和桌面图标 `icon.json`。需要三轴陀螺仪时，声明 `gyroscope` 就会选中 `gyroscope-webview`，由 Android 原生读取角速度，WebView 显示数据。相机、定位和 Health Connect 等会列为当前模板不支持的能力。
2. 在 Harness 聊天里点「打开手机桌面预览」，再点 App 图标进入应用。没有图标的项目会直接提供应用预览入口。使用 DSH Go 的本机引擎时，请在这台手机上打开。看完后回复修改意见或确认打包。链接有效期为 15 分钟，过期后回复「刷新预览」。陀螺仪的实时数据与硬件可用性可在目标设备安装 APK 后验证。
3. 确认打包后，插件检查页面、图标和模板是否与预览一致，构建并验证 APK。如果当前会话禁止弹出审批，切换到「工作区内修改」等会显示审批提示的模式再试。有 `present` 时，在聊天里点 APK 文件卡打开 Android 安装器。其他客户端可使用返回的文件链接。
4. 要更新应用，继续使用原项目。保留 `app.json`、`dist/` 和原签名密钥，插件会递增版本号并使用同一包名和签名，支持覆盖安装。

桌面图标预览会在模拟手机壁纸上显示 App 名称和圆角图标，点图标即可打开同一版本的应用预览。图标会打包为 Android 自适应图标，最终轮廓由设备的启动器决定。旧项目可以在原目录补上 `icon.json`，再预览和打包。

插件使用 Android Activity 和 WebView 运行单文件 HTML、CSS、JavaScript，支持 `localStorage`。陀螺仪模板在前台采样，通过页面同源的 `GET /gyroscope.json` 提供 X/Y/Z 角速度（rad/s）和开机后的采样时间。GPS、Health Connect、通用 Gradle 项目和自动设备测试属于后续能力。生成 APK 使用本地开发签名，适合直接安装试用。

## 从源码安装

在仓库根目录执行 `npm pack`。若在电脑上打包，先把生成的 `.tgz` 文件传到手机，再在 DSH Go 的本机终端运行下列命令。把路径和文件名换成实际的打包结果。

```sh
dsh plugin --profile web add /absolute/path/to/dsh-go-android-app-0.1.1.tgz
```

安装后重启 DSH Go 的本机引擎。[DSH Go 插件开发指南](https://github.com/ccch1mneyyy/dsh-Go/blob/v1.0.13/docs/plugins/from-zero.md)

## 从旧名称迁移

旧包名是 `dsh-go-app`。在 DSH Go 本机终端移除旧包，再安装新包，然后重启本机引擎。

```sh
dsh plugin --profile web remove dsh-go-app
dsh plugin --profile web add https://registry.npmjs.org/dsh-go-android-app/-/dsh-go-android-app-0.1.1.tgz
```

继续使用原工作区里的项目即可。新包沿用 `~/.local/share/dsh-go-app/` 中的工具链配置和签名密钥，以及 `DSH_GO_APP_HOME` 等已有环境变量，便于继续构建和覆盖安装已有应用。

**开发预览。** 已验证桌面 Harness 加载插件和签名构建，以及 Android 模拟器覆盖安装后保留应用数据。另在一台 Android 16 真机上通过 DSH Go 完成了陀螺仪模板选择、页面生成、预览、签名、安装和实时采样。

## 从想法到 APK

「随身跑记」案例在原生构建阶段单独接入了 GPS 和 Health Connect。这两项能力尚未进入插件模板。案例需求如下。

> 直接在这台真机做一个中文原生 Android App「随身跑记」。从 Health Connect 经用户授权读取今日总步数和最近跑步记录。用户点击开始后用手机 GPS 记录用时、距离和平均配速，结束后保存到本机并在 App 里查看。

1. 先请 DSH Go 用插件预览「随身跑记」的离线界面。打开手机桌面预览，点橙色的 **随身跑记** 图标进入应用预览。
2. 确认界面后，在同一 DSH Go 会话里要求 **用 Android SDK 构建并签名随身跑记的原生 APK**。打开 APK，在 Android 安装器确认安装。
3. 打开随身跑记，按系统提示授权后开始跑步。结束时保存记录，可以回看用时、距离、平均配速和轨迹。

桌面预览由插件生成，点开的是原 APK 中的页面。浏览器预览中的健康数据是示例数据。安装后的跑步画面来自 Android 14 模拟器，轨迹使用模拟定位。Health Connect 和 GPS 由 DSH Go 在原生构建阶段接入，目前尚未接入插件模板。
