const PROFILE_VERSION = 3;

const READING_PROFILE = {
  id: "reading",
  version: PROFILE_VERSION,
  promptContext: "围绕阅读、听书、知识获取、阅读习惯和内容消费场景分析。",
  scriptTypes: [
    { label: "替代刷屏/微学习", pattern: /scroll|doom|social media|micro.?learning|碎片|刷屏|短视频|微学习/i },
    { label: "读书管理/记录", pattern: /tracker|tracking|progress|goal|calendar|stats|goodreads|阅读记录|追踪|统计|目标|进度/i },
    { label: "痛点功能演示", pattern: /scan|ocr|adhd|dyslexia|listen|text to speech|pdf|朗读|扫描|拍照|倍速|注意力/i },
    { label: "主题书单/挑战", pattern: /challenge|day \d+|days?|books? list|recommend|tbr|书单|挑战|每天|阅读计划/i },
    { label: "知识内容场景挂载", pattern: /youtube|podcast|sponsor|download|知识类|播客|赞助|安装入口/i },
    { label: "泛知识/观点口播", pattern: /[\s\S]*/ }
  ],
  summaries: {
    "替代刷屏/微学习": "先命名低价值习惯，再给出低门槛学习动作，把成长承诺变成日常任务。",
    "主题书单/挑战": "用 Day-by-day、书单或挑战组织剧情，让用户觉得收藏后可以照着执行。",
    "痛点功能演示": "从读不完、注意力差、扫描朗读等具体问题切入，再用 UI 路径证明功能价值。",
    "读书管理/记录": "围绕进度、统计、目标和连续性展开，让阅读行为变得可管理。",
    "知识内容场景挂载": "先用观点、播客或知识内容建立信任，再把 App 作为自然承接入口。",
    "泛知识/观点口播": "依靠观点或反常识抓人，产品露出较弱，更适合验证选题与评论需求。"
  }
};

const MUSIC_PROFILE = {
  id: "music-social",
  version: PROFILE_VERSION,
  promptContext: "围绕音乐品味、好友关系、实时听歌动态、听歌数据、歌曲发现和线下点歌场景分析；只使用输入中可见的音乐产品事实。",
  scriptTypes: [
    { label: "场景点歌/播放控制", pattern: /touchtunes|jukebox|queued? (?:this )?song|pool hall|点歌|点播|台球厅|酒吧|场馆|venue|播放队列/i },
    { label: "歌曲发现/求推荐", pattern: /similar songs?|song recommendations?|recommend me|discover music|find (?:a )?song|what song|相似歌曲|求推荐|歌曲推荐|发现新歌|歌荒/i },
    { label: "好友动态/社交连接", pattern: /equals|friends?|match|chat|social|people (?:are )?listening|everyone.*listening|around.*listening|same music taste|好友|朋友|匹配|聊天|社交|同好|同频|周围人.*听|正在听什么|音乐品味相同/i },
    { label: "听歌数据/回顾", pattern: /stats\.fm|listening stats|listening history|wrapped|recap|minutes listened|top artists?|听歌统计|听歌数据|收听数据|年度回顾|历史记录/i },
    { label: "音乐身份/品味表达", pattern: /music taste|listening habit|my feed|playlist|favorite (?:song|artist|album)|genre|vibe|aesthetic|品味|听歌习惯|歌单|最爱歌手|音乐人格|俄语说唱/i },
    { label: "产品功能演示", pattern: /widget|feature|download|how to|tutorial|app|界面|功能|下载|使用方法|小组件/i },
    { label: "音乐情绪/反应剧情", pattern: /[\s\S]*/ }
  ],
  summaries: {
    "场景点歌/播放控制": "把 App 放进酒吧、台球厅、聚会等真实播放场景，用现场反应证明点歌和控制价值。",
    "听歌数据/回顾": "把统计、回顾和阶段性偏好变成可展示、可分享的个人音乐档案。",
    "歌曲发现/求推荐": "用具体歌曲、氛围或歌荒问题发起推荐需求，天然拉动评论和收藏。",
    "好友动态/社交连接": "先展示看到朋友正在听什么、匹配同好或开始聊天的社交结果，再解释产品机制。",
    "音乐身份/品味表达": "把听歌习惯、歌单和音乐品味当作人格表达，靠自我暴露和共鸣吸引互动。",
    "产品功能演示": "用真实界面或小组件证明查看动态、分享歌曲、匹配同好等关键动作。",
    "音乐情绪/反应剧情": "借具体歌曲、表情反应或关系剧情制造情绪共鸣，产品只承担场景触发器。"
  }
};

const GENERIC_PROFILE = {
  id: "generic",
  version: PROFILE_VERSION,
  promptContext: "围绕该垂类真实用户场景、产品动作和可见结果分析，不引入输入未出现的其他行业概念。",
  scriptTypes: [
    { label: "产品功能演示", pattern: /feature|how to|tutorial|download|app|界面|功能|下载|教程|操作/i },
    { label: "清单/挑战/教程", pattern: /challenge|day \d+|checklist|steps?|tips?|挑战|清单|步骤|技巧|教程/i },
    { label: "结果反差/前后对比", pattern: /before|after|result|changed|difference|前后|结果|变化|对比/i },
    { label: "用户故事/体验分享", pattern: /my experience|i tried|story|review|体验|经历|故事|实测/i },
    { label: "趋势梗/情绪共鸣", pattern: /pov|meme|relatable|reaction|trend|梗|反应|共鸣|太真实/i },
    { label: "痛点场景口播", pattern: /problem|struggle|need|want|pain|问题|困扰|需要|想要|痛点/i },
    { label: "品牌定位/概念介绍", pattern: /[\s\S]*/ }
  ],
  summaries: {
    "产品功能演示": "用真实界面、关键动作和结果反馈证明产品能完成承诺。",
    "清单/挑战/教程": "把内容组织成可执行步骤或连续任务，增强收藏与复看动机。",
    "结果反差/前后对比": "先展示使用前后的明显差异，再回溯产品动作和使用条件。",
    "用户故事/体验分享": "通过具体经历、使用过程和主观感受建立可信度。",
    "趋势梗/情绪共鸣": "借平台梗、反应或关系情绪抓停，产品作为剧情触发器出现。",
    "痛点场景口播": "先把用户问题放进真实场景，再给出一个低门槛解决动作。",
    "品牌定位/概念介绍": "用一句清晰类比或定位说明产品是什么、适合谁以及核心差异。"
  }
};

export function resolveVerticalVideoProfile(category = {}) {
  const label = String(category.label || category.appCategoryLabel || category.id || "").trim();
  if (/读书|阅读|听书|book|reading|audiobook|learning/i.test(label)) return READING_PROFILE;
  if (/音乐|music|audio|听歌|歌曲/i.test(label)) return MUSIC_PROFILE;
  return GENERIC_PROFILE;
}

export function classifyVerticalVideoScript(profile = GENERIC_PROFILE, text = "") {
  const source = String(text || "");
  return profile.scriptTypes.find((item) => item.pattern.test(source))?.label
    || profile.scriptTypes[profile.scriptTypes.length - 1]?.label
    || "未分类脚本";
}

export function getVerticalVideoScriptTypeSummary(profile = GENERIC_PROFILE, label = "") {
  return profile.summaries?.[label]
    || GENERIC_PROFILE.summaries?.[label]
    || "这类脚本结构较分散，建议回看高互动样本确认主要剧情和承接方式。";
}
