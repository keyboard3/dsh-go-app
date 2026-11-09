# dsh-go-app

在 DeepSeek Harness 里创建一个可编辑的 Android App 项目，先用本机浏览器预览，再签名生成独立 APK。安装后，生成的 App 可以单独打开，离线运行。

**开发预览 `0.1.0`**。已验证桌面 Harness 加载插件、签名构建，以及 Android 模拟器覆盖安装后保留应用数据。真机 DSH Go 的端到端流程待验证。

## 安装插件

当前插件接口针对 DSH Go 1.0.13 自带的 DeepSeek Harness `0.2.2-rc.1`，需要 Node.js 24.9 或更新版本。用源码打包，然后在 DSH Go 的本机终端里安装。若在电脑打包，先把 `.tgz` 文件传到手机。

```sh
npm pack
dsh plugin --profile web add /absolute/path/to/dsh-go-app-0.1.0.tgz
```

安装后重启 DSH Go 的本机引擎。安装方法见 [DSH Go 插件指南](https://github.com/ccch1mneyyy/dsh-Go/blob/v1.0.13/docs/plugins/from-zero.md)。

## 配置构建环境

先准备能在构建机上运行的 JDK 17 或更新版本、Android API 34 的 `android.jar`、`aapt2`、`zipalign`、`d8.jar` 和 `apksigner.jar`。在 ARM64 手机的 PRoot 环境里，`aapt2` 和 `zipalign` 必须能在 ARM64 Linux 上运行。Java 工具使用同一份 JDK。

在 DSH Go 终端里运行下列命令。将 `PLUGIN` 改成插件的安装路径，并将参数替换成环境里实际的绝对路径。默认 DSH Home 是 `~/.dsh`。

```sh
PLUGIN="${DSH_HOME:-$HOME/.dsh}/profiles/web/node_modules/dsh-go-app"
node "$PLUGIN/bin/dsh-go-app.js" configure \
  /path/to/jdk /path/to/build-tools-bin /path/to/android.jar /path/to/tool-jars
node "$PLUGIN/bin/dsh-go-app.js" doctor
```

标准桌面 SDK 布局也可通过 `JAVA_HOME` 和 `ANDROID_HOME` 定位 Build Tools 34.0.0 及 API 34。配置和本地签名密钥保存在 `~/.local/share/dsh-go-app/`，可用 `DSH_GO_APP_HOME` 指定目录。

## 从想法到 APK

在有工作目录的 DSH Go 会话中输入「做一个能保存计数的 App。我看完预览，再打成 APK。」

1. Harness 创建 `dsh-apps/<项目 ID>/`，并编辑其中的 `index.html`。
2. 将预览链接复制到同一台设备的浏览器。预览服务只监听 `127.0.0.1`，链接有效期为 15 分钟。继续修改后重新预览。
3. 确认打包后，插件检查页面与预览的 SHA-256 一致，构建并验证 APK。Harness 返回 APK 文件链接，有 `present` 时也交付文件卡。打开 APK 后，在 Android 安装器确认安装。
4. 要更新应用，继续使用原项目。保留 `app.json`、`dist/` 和原签名密钥，插件会递增版本号并使用同一包名和签名，支持覆盖安装。

第一版使用 Android Activity 和 WebView 运行单文件 HTML、CSS、JavaScript，支持 `localStorage`。工具链需要预先配置。GPS、Health Connect、通用 Gradle 项目和自动设备测试属于后续能力。生成 APK 使用本地开发签名，适合直接安装试用。
