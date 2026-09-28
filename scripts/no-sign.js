// 用于未签名构建：顶掉 electron-builder 默认的 Windows 代码签名流程，
// 避免它去下载/解压 winCodeSign（其中仅 macOS 的 dylib 符号链接在当前环境无法创建）。
// 该脚本不做任何签名，直接返回，产物为未签名 exe（安装时 Windows 会弹 SmartScreen 警告，属正常）。
exports.default = async function noSign(configuration) {
  // configuration.path 等字段本应交给签名工具，这里直接跳过
  return;
};
