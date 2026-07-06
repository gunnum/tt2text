# Doubao Voice Playground

本目录是独立的火山豆包 TTS playground，用于测试读书短视频旁白参数。

## 启动

```bash
PORT=3017 node server.mjs
```

页面地址保持不变：

```text
http://localhost:3017/doubao-voice-playground.html
```

## 文件

- `doubao-voice-playground.html`：前端页面
- `doubao-voice-service.mjs`：火山 TTS、逐句生成、本地随机句间隔、重新本地合成
- `doubao-voice-routes.mjs`：页面和 API 路由

输出音频仍在：

```text
data/doubao-voice-playground
```

## 密钥

火山 `API_KEY` 和 `APP_ID` 已保存到 macOS Keychain：

- service: `volcengine-doubao-voice`
- account: `api-key`
- account: `app-id`

不要打印、提交或写入密钥。

## 当前能力

- 普通版异步长文本合成可用
- 情感预测版置灰：当前账号请求返回 403
- `BV104_streaming` 保留但置灰：实测输出质量不行
- 音色列表已按火山豆包语音「小模型音色列表」在线音色表补齐，当前包含中文、多语种和方言在线音色
- `BV027_streaming` 是官网小模型在线表里的「美式女声-Amelia」，已收录
- 参数生成后保留，刷新页面会恢复
- 本地随机句间隔：按句子拆开生成，每句之间用 FFmpeg 插入随机静音
- 句间隔按句长加权：前一句越长，停顿越接近最大值；短句越接近最小值
- 重新本地合成：复用逐句音频，只重新拼接不同句间隔，不再请求豆包

## 音色列表维护

本 playground 当前调用的是火山豆包语音异步长文本合成的小模型在线接口，音色来源优先参考：

```text
https://www.volcengine.com/docs/6561/97465?lang=zh
```

如果官网页面是 JS 壳，可以直接查文档接口：

```bash
curl -sS 'https://www.volcengine.com/api/doc/getDocDetail?DocumentID=97465&LibraryID=6561&lang=zh'
```

维护原则：

- 只把「在线音色列表」里适合当前接口的 `*_streaming` 音色放进页面下拉。
- 不混入「离线音色列表」和 V5 `_24k_streaming` 表，除非服务端接口也同步支持并实测通过。
- 保留本地质量判断，例如 `BV104_streaming` 虽然官网收录，但这里继续置灰。
- 新增音色后先跑 `node --check doubao-voice-playground/doubao-voice-service.mjs`，再确认 `/api/doubao-voice/options` 能返回目标音色。
