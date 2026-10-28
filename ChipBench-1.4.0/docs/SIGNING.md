# Windows 报“有风险”与代码签名

## 原因

自己编译的 `chipbench.exe` 和安装包**没有数字签名**。Windows 的 SmartScreen / 智能应用控制对没签名、下载量又少的程序会弹出“Windows 已保护你的电脑”，这和代码内容无关。

## 根本解决：用代码签名证书签名

1. 向公司 IT 申请**代码签名证书**（Code Signing，最好是 EV 证书：EV 签名的程序一开始就不会被 SmartScreen 拦截；普通 OV 证书需要积累一段时间的信誉）。
2. 把证书导入到“当前用户 → 个人”证书存储，记下**指纹**（证书详情里的 Thumbprint，40 位十六进制，去掉空格）。
3. 编译前设置环境变量后再运行构建脚本：

```bat
set CHIPBENCH_CERT_THUMBPRINT=0123ABCD...（你的指纹）
build-windows.bat
```

脚本会让 Tauri 用 `signtool` 给 `chipbench.exe` 和 NSIS / MSI 安装包签名，并加时间戳（`http://timestamp.digicert.com`，可在 `src-tauri/tauri.conf.json` 的 `bundle.windows.timestampUrl` 修改）。需要安装 Windows SDK（自带 signtool）。

## 拿到证书之前

- 首次运行时点“**更多信息 → 仍要运行**”。
- 从网盘 / 邮件下载的 exe 带“来自网络”标记：右键 → 属性 → 勾选“**解除锁定**”。
- 在公司内分发时，请走 IT 的软件分发渠道（如 Intune / 软件中心），或请 IT 把程序加入允许列表。**不要**为此关闭 SmartScreen 或杀毒软件。
