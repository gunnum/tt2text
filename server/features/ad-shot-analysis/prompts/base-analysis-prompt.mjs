export function buildBaseAnalysisPrompt({
  sourceContextLine = "",
  sourceText = "",
  isNormalTikTokVideo = false,
  singleBeatHint = {},
  transcriptSignal = {}
} = {}) {
  return [
    "Use $ad-video-analyzer.",
    sourceContextLine,
    "请根据转写、画面语义、画面文字时间轴和基础元数据，输出适合入库展示的结构化中文 JSON。",
    "要求：",
    "- cardTitle 点出核心产品功能和视频解决的问题，不要只复述开头 hook。",
    "- cardSummary 用 2 到 3 句中文浓缩剧情、产品功能和解决的问题。",
    "- videoStory 按顺序讲清视频剧情：开头问了什么，中间展示了什么，哪个功能回答了问题，如何收尾。",
    "- script 是可读脚本，可以按镜头、字幕或口播顺序组织。",
    "- hook 只写开头提出的具体问题、动作、反差或结果，不要拔高成营销术语。",
    "- productFeatures 逐条列出视频里展示或说到的具体 App 功能。",
    "- productMechanism 用 1 到 2 句解释这些功能如何解决视频开头的问题。",
    "- creativeStrategy 只分析跨行业也成立的创意结构，不输出垂类名称或垂类脚本类型。",
    "- creativePattern 只能从 pain_point_demo、result_first、ugc_story、listicle、challenge、tutorial、comparison、social_proof、single_beat、other 中选择。",
    "- appExposureLevel 只能从 strong、medium、weak 中选择。",
    "- hookMechanism 说明 Hook 用什么具体信息抓停；creativeMechanism 说明整条视频如何从 Hook 推进到产品或结果。",
    "- storyboardScenes 是唯一分镜事实源，按真实内容决定数量，不要固定成 2 段或 5 段。",
    "- 每个分镜包含 start、end、scene、role、whyItWorks、frameTime。不要输出 sceneId 或 framePath，它们由系统生成。",
    "- role 只能从 hook、problem、context、product_entry、feature_demo、proof、result、cta 中选择。",
    "- start/end/frameTime 使用秒；frameTime 应位于 start 和 end 之间，并避开转场边界。",
    "- whyItWorks 只解释该镜头在本视频叙事中的作用，不根据互动数据宣称因果。",
    "- reusableTemplate 提炼这条视频可复用的结构，但不要引入输入中没有的行业概念。",
    "- onScreenTextOriginal/onScreenTextZh 只记录画面中主要大字或字幕；没有就留空。",
    ...(singleBeatHint?.isSingleBeat ? [
      "- 这条视频基本是单镜头或单信息点，storyboardScenes 只输出 1 条，不要虚构转场。"
    ] : []),
    ...(transcriptSignal?.ignoreTranscript ? [
      "- 音轨和主画面文案冲突，音轨更像 BGM 歌词或环境声；剧情和分镜以画面文字及画面变化为准。"
    ] : []),
    ...(isNormalTikTokVideo ? [
      "- 普通 TikTok 视频没有 TTCC 的 CTR、预算或投放排名，不要编造这些信息。",
      "- 用户故事、教程或自然讨论也要按真实素材结构拆解。"
    ] : []),
    "只返回 JSON，不要 Markdown。形状如下：",
    JSON.stringify({
      cardTitle: "...",
      cardSummary: "...",
      videoStory: "...",
      script: "...",
      hook: "...",
      productFeatures: ["..."],
      productMechanism: "...",
      creativeStrategy: {
        creativePattern: "pain_point_demo",
        appExposureLevel: "strong",
        hookMechanism: "...",
        creativeMechanism: "..."
      },
      storyboardScenes: [{
        start: 0,
        end: 3.2,
        scene: "...",
        role: "hook",
        whyItWorks: "...",
        frameTime: 1.2
      }],
      reusableTemplate: "...",
      onScreenTextOriginal: "...",
      onScreenTextZh: "..."
    }),
    "",
    sourceText
  ].join("\n");
}

export function buildBaseAnalysisRepairPrompt({ originalPrompt = "", previousAnalysis = {}, issues = [], round = 2 } = {}) {
  return [
    originalPrompt,
    "",
    `这是第 ${round} 轮修复。上一版结果没有通过结构校验。`,
    "只修复下面的问题，并重新返回完整 JSON：",
    ...issues.map((issue) => `- ${issue.message || issue.code || "结构不完整"}`),
    "上一版结果：",
    JSON.stringify(previousAnalysis)
  ].join("\n");
}
