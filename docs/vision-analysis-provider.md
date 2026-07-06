# 视觉分析 Provider 开关

短视频画面理解默认走 Agnes；需要回退到本机 Codex CLI 时，用环境变量切换。

## 默认配置

```bash
TT2TEXT_VISION_PROVIDER=agnes
TT2TEXT_AGNES_VISION_MODEL=agnes-1.5-flash
AGNES_BASE_URL=https://apihub.agnes-ai.com/v1
```

`agnes-1.5-flash` 支持文本 + 图片输入，适合视频抽帧后的 OCR、画面理解和视觉总结。

## 切到 Agnes

```bash
export TT2TEXT_VISION_PROVIDER=agnes
export TT2TEXT_AGNES_VISION_MODEL=agnes-1.5-flash
```

API key 读取顺序：

1. `AGNES_API_KEY`
2. `TT2TEXT_AGNES_API_KEY`
3. macOS Keychain：account 为 `default`，service 为 `agnes-ai`

推荐用 Keychain 保存：

```bash
read -s AGNES_API_KEY
security add-generic-password -a default -s agnes-ai -U -w "$AGNES_API_KEY"
unset AGNES_API_KEY
```

## 切到本机 Codex CLI

```bash
export TT2TEXT_VISION_PROVIDER=codex
```

可选指定 CLI 路径：

```bash
export TT2TEXT_CODEX_BIN=codex
```

Codex 模式会调用：

```bash
codex exec --ephemeral --skip-git-repo-check --output-last-message <visual-summary.json> --image <frame> -
```

## 输出文件

两种 provider 都写入同一个文件：

```text
.tmp/.../visual-summary.json
```

格式保持一致：

```json
{
  "summary_zh": "中文画面总结",
  "visual_text_segments": [
    {
      "start": 0,
      "end": 2.4,
      "original": "画面原文",
      "zh": "中文解释"
    }
  ]
}
```

## 什么时候用哪个

- Agnes：默认选择，速度和成本更适合批量视频抽帧。
- Codex CLI：当 Agnes key 不可用、需要本机模型链路复核，或要对比视觉总结质量时使用。

无论走哪个 provider，后续 TikTok 素材分析只消费统一的 `summary_zh` 和 `visual_text_segments`。
