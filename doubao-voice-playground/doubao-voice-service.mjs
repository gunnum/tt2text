import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SERVICE_NAME = "volcengine-doubao-voice";
const SUBMIT_URL = "https://openspeech.bytedance.com/api/v1/tts_async/submit";
const QUERY_URL = "https://openspeech.bytedance.com/api/v1/tts_async/query";
const EMOTION_SUBMIT_URL = "https://openspeech.bytedance.com/api/v1/tts_async_with_emotion/submit";
const EMOTION_QUERY_URL = "https://openspeech.bytedance.com/api/v1/tts_async_with_emotion/query";
const EMOTION_DISABLED_REASON = "当前账号请求情感预测版接口返回 403，需在火山控制台开通后再启用。";
const SMALL_MODEL_VOICE_DOC_URL = "https://www.volcengine.com/docs/6561/97465?lang=zh";

// Source: 火山引擎豆包语音「小模型音色列表」在线音色表，2026-06-16 refresh.
// Keep local quality overrides, such as BV104_streaming, in this list rather than in UI code.
const DEFAULT_VOICE_TYPES = [
  voice({ value: "BV009_streaming", name: "知性女声", gender: "女", scene: "中文 / 智能助手", note: "优先推荐：适合读书/知识内容旁白；支持通用、愉悦、抱歉、专业、严肃。" }),
  voice({ value: "BV007_streaming", name: "亲切女声", gender: "女", scene: "中文 / 智能助手", note: "亲和、适合说明类内容。" }),
  voice({ value: "BV405_streaming", name: "甜美小源", gender: "女", scene: "中文 / 智能助手", note: "甜美型女声；支持通用、愉悦、抱歉、专业、严肃。" }),
  voice({ value: "BV005_streaming", name: "活泼女声", gender: "女", scene: "中文 / 视频配音", note: "更活泼，适合短视频口播。" }),
  voice({ value: "BV011_streaming", name: "新闻女声", gender: "女", scene: "中文 / 新闻播报", note: "更正式、播报感。" }),
  voice({ value: "BV034_streaming", name: "知性姐姐-双语", gender: "女", scene: "中文 / 教育场景", note: "适合知识/教育类，也可做中英混合内容。" }),
  voice({ value: "BV027_streaming", name: "美式女声-Amelia", gender: "女", scene: "多语种 / 美式英语", note: "官网小模型在线表收录；适合纯英文或英文段落。" }),
  voice({ value: "BV104_streaming", name: "温柔淑女", gender: "女", scene: "中文 / 有声阅读", disabled: true, note: "官网收录，但本地实测输出质量不行，暂时禁用。" }),
  voice({ value: "BV113_streaming", name: "甜宠少御", gender: "女", scene: "中文 / 有声阅读", note: "偏角色感；支持旁白、平和、开心、悲伤、生气、害怕、厌恶、惊讶。" }),
  voice({ value: "BV115_streaming", name: "古风少御", gender: "女", scene: "中文 / 有声阅读", note: "偏角色/古风；支持旁白、平和、开心、悲伤、生气、害怕、厌恶、惊讶。" }),
  voice({ value: "BV700_streaming", name: "灿灿", gender: "女", scene: "中文 / 通用场景", note: "通用女声，支持多情感/风格和多语种。" }),
  voice({ value: "BV064_streaming", name: "小萝莉", gender: "女", scene: "中文 / 视频配音", note: "更年轻、角色感更强；支持通用、开心、悲伤、生气、害怕、厌恶、惊讶。" }),
  voice({ value: "BV511_streaming", name: "慵懒女声-Ava", gender: "女", scene: "多语种 / 美式英语", note: "偏松弛的英文女声；支持通用、开心、悲伤、生气、害怕、厌恶、惊讶。" }),

  voice({ value: "BV700_V2_streaming", name: "灿灿 2.0", scene: "中文 / 通用场景", note: "支持 22 种情感/风格。" }),
  voice({ value: "BV705_streaming", name: "炀炀", scene: "中文 / 通用场景", note: "支持自然对话、愉悦、抱歉、嗔怪、安慰鼓励、讲故事等。" }),
  voice({ value: "BV701_V2_streaming", name: "擎苍 2.0", scene: "中文 / 通用场景", note: "支持旁白-舒缓、旁白-沉浸、平和、开心、悲伤、生气、害怕、厌恶、惊讶、哭腔。" }),
  voice({ value: "BV001_V2_streaming", name: "通用女声 2.0", gender: "女", scene: "中文 / 通用场景" }),
  voice({ value: "BV406_V2_streaming", name: "超自然音色-梓梓2.0", scene: "中文 / 通用场景" }),
  voice({ value: "BV406_streaming", name: "超自然音色-梓梓", scene: "中文 / 通用场景", note: "支持通用、开心、悲伤、生气、害怕、厌恶、惊讶。" }),
  voice({ value: "BV407_V2_streaming", name: "超自然音色-燃燃2.0", scene: "中文 / 通用场景" }),
  voice({ value: "BV407_streaming", name: "超自然音色-燃燃", scene: "中文 / 通用场景" }),
  voice({ value: "BV001_streaming", name: "通用女声", gender: "女", scene: "中文 / 通用场景", note: "支持助手、客服、广告、讲故事等 12 种情感/风格。" }),
  voice({ value: "BV002_streaming", name: "通用男声", gender: "男", scene: "中文 / 通用场景" }),

  voice({ value: "BV701_streaming", name: "擎苍", gender: "男", scene: "中文 / 有声阅读", note: "支持旁白-舒缓、旁白-沉浸、平和、开心、悲伤、生气、害怕、厌恶、惊讶、哭腔。" }),
  voice({ value: "BV123_streaming", name: "阳光青年", gender: "男", scene: "中文 / 有声阅读", note: "支持平和、开心、悲伤、生气、害怕、厌恶、惊讶。" }),
  voice({ value: "BV120_streaming", name: "反卷青年", gender: "男", scene: "中文 / 有声阅读 / 视频配音", note: "支持平和、开心、悲伤、生气、害怕、厌恶、惊讶。" }),
  voice({ value: "BV119_streaming", name: "通用赘婿", gender: "男", scene: "中文 / 有声阅读", note: "支持旁白、平和、开心、悲伤、生气、害怕、厌恶、惊讶。" }),
  voice({ value: "BV107_streaming", name: "霸气青叔", gender: "男", scene: "中文 / 有声阅读", note: "支持旁白、平和、开心、悲伤、生气、害怕、厌恶、惊讶。" }),
  voice({ value: "BV100_streaming", name: "质朴青年", gender: "男", scene: "中文 / 有声阅读", note: "支持旁白、平和、开心、悲伤、生气、害怕、厌恶、惊讶。" }),
  voice({ value: "BV004_streaming", name: "开朗青年", gender: "男", scene: "中文 / 有声阅读", note: "支持旁白、平和、开心、悲伤、生气、害怕、厌恶、惊讶。" }),
  voice({ value: "BV102_streaming", name: "儒雅青年", gender: "男", scene: "中文 / 有声阅读", note: "支持旁白、平和、开心、悲伤、生气、害怕、厌恶、惊讶。" }),

  voice({ value: "BV419_streaming", name: "诚诚", scene: "中文 / 智能助手" }),
  voice({ value: "BV415_streaming", name: "童童", scene: "中文 / 智能助手" }),
  voice({ value: "BV008_streaming", name: "亲切男声", gender: "男", scene: "中文 / 智能助手", note: "支持通用、愉悦、抱歉、专业、严肃。" }),

  voice({ value: "BV408_streaming", name: "译制片男声", gender: "男", scene: "中文 / 视频配音" }),
  voice({ value: "BV426_streaming", name: "懒小羊", scene: "中文 / 视频配音" }),
  voice({ value: "BV428_streaming", name: "清新文艺女声", gender: "女", scene: "中文 / 视频配音" }),
  voice({ value: "BV403_streaming", name: "鸡汤女声", gender: "女", scene: "中文 / 视频配音" }),
  voice({ value: "BV158_streaming", name: "智慧老者", scene: "中文 / 视频配音" }),
  voice({ value: "BV157_streaming", name: "慈爱姥姥", gender: "女", scene: "中文 / 视频配音" }),
  voice({ value: "BR001_streaming", name: "说唱小哥", gender: "男", scene: "中文 / 视频配音" }),
  voice({ value: "BV410_streaming", name: "活力解说男", gender: "男", scene: "中文 / 视频配音" }),
  voice({ value: "BV411_streaming", name: "影视解说小帅", gender: "男", scene: "中文 / 视频配音" }),
  voice({ value: "BV437_streaming", name: "解说小帅-多情感", gender: "男", scene: "中文 / 视频配音", note: "支持通用、开心、悲伤、生气、害怕、厌恶、惊讶。" }),
  voice({ value: "BV412_streaming", name: "影视解说小美", gender: "女", scene: "中文 / 视频配音" }),
  voice({ value: "BV159_streaming", name: "纨绔青年", gender: "男", scene: "中文 / 视频配音" }),
  voice({ value: "BV418_streaming", name: "直播一姐", gender: "女", scene: "中文 / 视频配音" }),
  voice({ value: "BV142_streaming", name: "沉稳解说男", gender: "男", scene: "中文 / 视频配音" }),
  voice({ value: "BV143_streaming", name: "潇洒青年", gender: "男", scene: "中文 / 视频配音" }),
  voice({ value: "BV056_streaming", name: "阳光男声", gender: "男", scene: "中文 / 视频配音" }),

  voice({ value: "BV051_streaming", name: "奶气萌娃", scene: "中文 / 特色音色" }),
  voice({ value: "BV063_streaming", name: "动漫海绵", scene: "中文 / 特色音色" }),
  voice({ value: "BV417_streaming", name: "动漫海星", scene: "中文 / 特色音色" }),
  voice({ value: "BV050_streaming", name: "动漫小新", scene: "中文 / 特色音色" }),
  voice({ value: "BV061_streaming", name: "天才童声", scene: "中文 / 特色音色" }),
  voice({ value: "BV401_streaming", name: "促销男声", gender: "男", scene: "中文 / 广告配音" }),
  voice({ value: "BV402_streaming", name: "促销女声", gender: "女", scene: "中文 / 广告配音" }),
  voice({ value: "BV006_streaming", name: "磁性男声", gender: "男", scene: "中文 / 广告配音" }),
  voice({ value: "BV012_streaming", name: "新闻男声", gender: "男", scene: "中文 / 新闻播报" }),
  voice({ value: "BV033_streaming", name: "温柔小哥", gender: "男", scene: "中文 / 教育场景" }),

  voice({ value: "BV505_streaming", name: "议论女声-Alicia", gender: "女", scene: "多语种 / 美式英语" }),
  voice({ value: "BV138_streaming", name: "情感女声-Lawrence", gender: "女", scene: "多语种 / 美式英语", note: "支持旁白、平和、开心、悲伤、生气、害怕、厌恶、惊讶。" }),
  voice({ value: "BV502_streaming", name: "讲述女声-Amanda", gender: "女", scene: "多语种 / 美式英语" }),
  voice({ value: "BV503_streaming", name: "活力女声-Ariana", gender: "女", scene: "多语种 / 美式英语" }),
  voice({ value: "BV504_streaming", name: "活力男声-Jackson", gender: "男", scene: "多语种 / 美式英语" }),
  voice({ value: "BV421_streaming", name: "天才少女", gender: "女", scene: "多语种 / 多语言", note: "支持中文、英语、日语、葡语、西语、印尼语、越南语、泰语。" }),
  voice({ value: "BV702_streaming", name: "Stefan", gender: "男", scene: "多语种 / 多语言", note: "支持中文、英语、日语、葡语、西语、印尼语。" }),
  voice({ value: "BV506_streaming", name: "天真萌娃-Lily", scene: "多语种 / 美式英语" }),
  voice({ value: "BV040_streaming", name: "亲切女声-Anna", gender: "女", scene: "多语种 / 英式英语", note: "支持通用、开心、悲伤、生气、害怕、厌恶、惊讶。" }),
  voice({ value: "BV516_streaming", name: "澳洲男声-Henry", gender: "男", scene: "多语种 / 澳洲英语" }),
  voice({ value: "BV520_streaming", name: "元气少女", gender: "女", scene: "多语种 / 日语" }),
  voice({ value: "BV521_streaming", name: "萌系少女", gender: "女", scene: "多语种 / 日语" }),
  voice({ value: "BV522_streaming", name: "气质女声", gender: "女", scene: "多语种 / 日语" }),
  voice({ value: "BV524_streaming", name: "日语男声", gender: "男", scene: "多语种 / 日语" }),
  voice({ value: "BV531_streaming", name: "活力男声Carlos（巴西地区）", gender: "男", scene: "多语种 / 葡萄牙语" }),
  voice({ value: "BV530_streaming", name: "活力女声（巴西地区）", gender: "女", scene: "多语种 / 葡萄牙语" }),
  voice({ value: "BV065_streaming", name: "气质御姐（墨西哥地区）", gender: "女", scene: "多语种 / 西班牙语" }),

  voice({ value: "BV021_streaming", name: "东北老铁", gender: "男", scene: "方言 / 东北话" }),
  voice({ value: "BV020_streaming", name: "东北丫头", gender: "女", scene: "方言 / 东北话" }),
  voice({ value: "BV704_streaming", name: "方言灿灿", scene: "方言 / 多方言", note: "支持中文、东北、粤语、上海、西安、成都、台普、广西普通话。" }),
  voice({ value: "BV210_streaming", name: "西安佟掌柜", scene: "方言 / 西安话" }),
  voice({ value: "BV217_streaming", name: "沪上阿姐", gender: "女", scene: "方言 / 上海话" }),
  voice({ value: "BV213_streaming", name: "广西表哥", gender: "男", scene: "方言 / 广西普通话" }),
  voice({ value: "BV025_streaming", name: "甜美台妹", gender: "女", scene: "方言 / 台湾普通话" }),
  voice({ value: "BV227_streaming", name: "台普男声", gender: "男", scene: "方言 / 台湾普通话" }),
  voice({ value: "BV026_streaming", name: "港剧男神", gender: "男", scene: "方言 / 粤语" }),
  voice({ value: "BV424_streaming", name: "广东女仔", gender: "女", scene: "方言 / 粤语" }),
  voice({ value: "BV212_streaming", name: "相声演员", scene: "方言 / 天津话" }),
  voice({ value: "BV019_streaming", name: "重庆小伙", gender: "男", scene: "方言 / 川渝话" }),
  voice({ value: "BV221_streaming", name: "四川甜妹儿", gender: "女", scene: "方言 / 川渝话" }),
  voice({ value: "BV423_streaming", name: "重庆幺妹儿", gender: "女", scene: "方言 / 川渝话" }),
  voice({ value: "BV214_streaming", name: "乡村企业家", scene: "方言 / 郑州话" }),
  voice({ value: "BV226_streaming", name: "湖南妹坨", gender: "女", scene: "方言 / 湖南普通话" }),
  voice({ value: "BV216_streaming", name: "长沙靓女", gender: "女", scene: "方言 / 长沙话" })
];

function voice({ value, name, gender = "", scene = "通用", note = "", disabled = false }) {
  return {
    value,
    label: `${name} · ${value}`,
    name,
    gender,
    scene,
    note,
    disabled,
    source: SMALL_MODEL_VOICE_DOC_URL
  };
}

const ALLOWED_FORMATS = new Set(["mp3", "wav", "ogg_opus", "pcm"]);
const ALLOWED_SAMPLE_RATES = new Set([8000, 16000, 22050, 24000, 32000, 44100, 48000]);

export function createDoubaoVoiceService({ outputDir, logger = console } = {}) {
  if (!outputDir) {
    throw new Error("createDoubaoVoiceService 缺少 outputDir");
  }

  return {
    getOptions,
    generate,
    remixLocalPause,
    deleteResult
  };

  function getOptions() {
    return {
      defaults: {
        endpoint: "normal",
        resource_id: "volc.tts_async.default",
        voice_type: "BV009_streaming",
        format: "mp3",
        sample_rate: 24000,
        speed: 1,
        volume: 1,
        pitch: 1,
        sentence_interval: 0,
        local_sentence_pause: true,
        local_sentence_pause_min: 0.45,
        local_sentence_pause_max: 0.85,
        enable_subtitle: 1,
        wait: true,
        timeout_seconds: 180,
        poll_interval_seconds: 3
      },
      endpointOptions: [
        { value: "normal", label: "普通版异步长文本合成" },
        {
          value: "emotion",
          label: "情感预测版异步长文本合成",
          disabled: true,
          note: EMOTION_DISABLED_REASON
        }
      ],
      voiceTypes: DEFAULT_VOICE_TYPES,
      formats: ["mp3", "wav", "ogg_opus", "pcm"],
      sampleRates: [8000, 16000, 22050, 24000, 32000, 44100, 48000],
      voiceTypeSource: SMALL_MODEL_VOICE_DOC_URL,
      numericFields: [
        { name: "speed", label: "语速", defaultValue: 1, min: 0.5, max: 2, step: 0.05 },
        { name: "volume", label: "音量", defaultValue: 1, min: 0.1, max: 3, step: 0.05 },
        { name: "pitch", label: "音高", defaultValue: 1, min: 0.5, max: 2, step: 0.05 },
        { name: "local_sentence_pause_min", label: "本地句间隔最小值", defaultValue: 0.45, min: 0, max: 3, step: 0.05 },
        { name: "local_sentence_pause_max", label: "本地句间隔最大值", defaultValue: 0.85, min: 0, max: 3, step: 0.05 }
      ],
      notes: [
        "密钥只在服务端从 macOS Keychain 读取，页面不会接触 API_KEY 或 APP_ID。",
        "当前音色列表来自火山豆包语音小模型在线音色表；具体可用性取决于火山控制台里已开通的音色。",
        "异步任务返回的 audio_url 有效期较短，生成成功后服务端会立即下载成本地文件。"
      ]
    };
  }

  async function generate(input = {}) {
    const text = normalizeText(input.text);
    const params = normalizeParams(input);
    if (params.endpoint === "emotion") {
      throw new Error(EMOTION_DISABLED_REASON);
    }
    const credentials = await readCredentials();
    await fs.mkdir(outputDir, { recursive: true });
    if (params.wait && params.local_sentence_pause) {
      return generateWithLocalSentencePause({
        text,
        params,
        credentials,
        resourceId: input.resource_id || "volc.tts_async.default"
      });
    }

    return generateSingleText({
      text,
      params,
      credentials,
      resourceId: input.resource_id || (params.endpoint === "emotion" ? "volc.tts_async.emotion" : "volc.tts_async.default")
    });
  }

  async function generateSingleText({ text, params, credentials, resourceId, outputIdPrefix = "" }) {
    const reqid = randomUUID();
    const payload = {
      appid: credentials.appId,
      reqid,
      text,
      format: params.format,
      voice_type: params.voice_type,
      sample_rate: params.sample_rate,
      enable_subtitle: params.enable_subtitle
    };

    assignOptionalNumber(payload, "speed", params.speed);
    assignOptionalNumber(payload, "volume", params.volume);
    assignOptionalNumber(payload, "pitch", params.pitch);
    assignOptionalNumber(payload, "sentence_interval", params.sentence_interval);
    if (params.style) {
      payload.style = params.style;
    }

    const submitUrl = params.endpoint === "emotion" ? EMOTION_SUBMIT_URL : SUBMIT_URL;
    const queryUrl = params.endpoint === "emotion" ? EMOTION_QUERY_URL : QUERY_URL;
    const submitResult = await requestJson(submitUrl, {
      method: "POST",
      headers: buildHeaders(credentials.apiKey, resourceId),
      body: JSON.stringify(payload)
    });

    const taskId = submitResult.task_id || submitResult.taskId || submitResult.id;
    if (!taskId) {
      return {
        ok: false,
        stage: "submit",
        reqid,
        response: sanitizeResponse(submitResult)
      };
    }

    const result = {
      ok: true,
      reqid,
      task_id: taskId,
      submit: sanitizeResponse(submitResult),
      query: null,
      file: null,
      subtitle: null,
      url_expire_time: null
    };

    if (!params.wait) {
      return result;
    }

    const queryResult = await pollTask({
      queryUrl,
      appId: credentials.appId,
      apiKey: credentials.apiKey,
      resourceId,
      taskId,
      timeoutSeconds: params.timeout_seconds,
      pollIntervalSeconds: params.poll_interval_seconds
    });

    result.query = sanitizeResponse(queryResult);
    result.url_expire_time = queryResult.url_expire_time || queryResult.urlExpireTime || null;
    result.subtitle = queryResult.subtitle || queryResult.subtitles || queryResult.frontend || null;

    const audioUrl = queryResult.audio_url || queryResult.audioUrl || queryResult.url;
    if (audioUrl) {
      const file = await downloadAudio(audioUrl, {
        taskId,
        format: params.format,
        outputIdPrefix
      });
      result.file = file;
    }

    return result;
  }

  async function generateWithLocalSentencePause({ text, params, credentials, resourceId }) {
    if (params.format !== "mp3") {
      throw new Error("本地句间隔合成目前只支持 mp3 格式");
    }
    const sentences = splitSentences(text);
    if (sentences.length < 2) {
      return generateSingleText({ text, params: { ...params, sentence_interval: undefined }, credentials, resourceId });
    }

    const jobId = randomUUID();
    const jobDir = path.join(outputDir, `.tmp-${jobId}`);
    await fs.mkdir(jobDir, { recursive: true });
    const pieces = [];
    try {
      for (let index = 0; index < sentences.length; index += 1) {
        const sentence = sentences[index];
        const pieceResult = await generateSingleText({
          text: sentence,
          params: { ...params, sentence_interval: undefined },
          credentials,
          resourceId,
          outputIdPrefix: `${jobId}-part-${String(index + 1).padStart(2, "0")}-`
        });
        if (!pieceResult.file?.path) {
          throw new Error(`第 ${index + 1} 句未返回音频文件`);
        }
        pieces.push({ sentence, result: pieceResult, filePath: pieceResult.file.path });
      }
      const pausePlan = buildWeightedPauses(sentences, params.local_sentence_pause_min, params.local_sentence_pause_max);

      const finalId = `${jobId}.mp3`;
      const finalPath = path.join(outputDir, finalId);
      await concatAudioWithPauses({
        inputPaths: pieces.map((piece) => piece.filePath),
        pauses: pausePlan.map((item) => item.duration),
        outputPath: finalPath,
        workDir: jobDir
      });
      const stat = await fs.stat(finalPath);
      return {
        ok: true,
        reqid: jobId,
        task_id: jobId,
        mode: "local_sentence_pause",
        sentence_count: sentences.length,
        pauses: pausePlan.map((item) => item.duration),
        pause_plan: pausePlan,
        source_files: pieces.map((piece) => path.basename(piece.filePath)),
        parts: pieces.map((piece, index) => ({
          index: index + 1,
          text: piece.sentence,
          task_id: piece.result.task_id,
          source_file: path.basename(piece.filePath)
        })),
        file: {
          id: finalId,
          path: finalPath,
          url: `/data/doubao-voice-playground/${encodeURIComponent(finalId)}`,
          bytes: stat.size
        },
        subtitle: null,
        query: null,
        url_expire_time: null
      };
    } finally {
      await fs.rm(jobDir, { recursive: true, force: true });
    }
  }

  async function remixLocalPause(input = {}) {
    const sourceFiles = Array.isArray(input.source_files) ? input.source_files : [];
    if (sourceFiles.length < 2) {
      throw new Error("缺少可重新合成的逐句音频");
    }
    const min = clampNumber(input.local_sentence_pause_min, 0, 3, 0.45);
    const max = clampNumber(input.local_sentence_pause_max, 0, 3, 0.85);
    const sourceTexts = Array.isArray(input.source_texts) ? input.source_texts.filter((item) => typeof item === "string") : [];
    const pausePlan = sourceTexts.length === sourceFiles.length
      ? buildWeightedPauses(sourceTexts, min, max)
      : buildUniformPauses(sourceFiles.length - 1, min, max);
    const inputPaths = sourceFiles.map((id) => resolveResultFile(id));
    for (const filePath of inputPaths) {
      await fs.access(filePath);
    }
    await fs.mkdir(outputDir, { recursive: true });
    const jobId = randomUUID();
    const jobDir = path.join(outputDir, `.tmp-remix-${jobId}`);
    await fs.mkdir(jobDir, { recursive: true });
    try {
      const finalId = `${jobId}.mp3`;
      const finalPath = path.join(outputDir, finalId);
      await concatAudioWithPauses({
        inputPaths,
        pauses: pausePlan.map((item) => item.duration),
        outputPath: finalPath,
        workDir: jobDir
      });
      const stat = await fs.stat(finalPath);
      return {
        ok: true,
        task_id: jobId,
        mode: "local_sentence_pause_remix",
        sentence_count: sourceFiles.length,
        pauses: pausePlan.map((item) => item.duration),
        pause_plan: pausePlan,
        source_files: sourceFiles,
        file: {
          id: finalId,
          path: finalPath,
          url: `/data/doubao-voice-playground/${encodeURIComponent(finalId)}`,
          bytes: stat.size
        }
      };
    } finally {
      await fs.rm(jobDir, { recursive: true, force: true });
    }
  }

  async function deleteResult({ id } = {}) {
    if (!id || typeof id !== "string") {
      throw new Error("缺少要删除的音频 id");
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
      throw new Error("音频 id 不合法");
    }
    const target = resolveResultFile(id);
    await fs.rm(target, { force: true });
    return { ok: true, id };
  }

  async function readCredentials() {
    const [apiKey, appId] = await Promise.all([
      readKeychainValue("api-key"),
      readKeychainValue("app-id")
    ]);
    if (!apiKey || !appId) {
      throw new Error("Keychain 中缺少火山豆包语音凭证");
    }
    return { apiKey, appId };
  }

  async function readKeychainValue(account) {
    const { stdout } = await execFileAsync("security", [
      "find-generic-password",
      "-a",
      account,
      "-s",
      SERVICE_NAME,
      "-w"
    ]);
    return stdout.trim();
  }

  async function pollTask({ queryUrl, appId, apiKey, resourceId, taskId, timeoutSeconds, pollIntervalSeconds }) {
    const startedAt = Date.now();
    let lastResult = null;
    while (Date.now() - startedAt <= timeoutSeconds * 1000) {
      const url = new URL(queryUrl);
      url.searchParams.set("appid", appId);
      url.searchParams.set("task_id", taskId);
      const data = await requestJson(url, {
        method: "GET",
        headers: buildHeaders(apiKey, resourceId)
      });
      lastResult = data;
      const status = Number(data.task_status ?? data.taskStatus ?? data.status);
      if (status === 1 || data.audio_url || data.audioUrl || data.url) {
        return data;
      }
      if (status === 2) {
        throw new Error(`火山语音合成失败：${JSON.stringify(sanitizeResponse(data))}`);
      }
      await delay(pollIntervalSeconds * 1000);
    }

    throw new Error(`等待火山语音任务超时：${JSON.stringify(sanitizeResponse(lastResult || {}))}`);
  }

  async function requestJson(url, options) {
    const response = await fetchWithRetry(url, options, { label: "火山语音接口" });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (!response.ok) {
      logger.error?.("doubao voice request failed", response.status, sanitizeResponse(data));
      throw new Error(`火山语音请求失败：HTTP ${response.status}`);
    }
    return data;
  }

  async function downloadAudio(audioUrl, { taskId, format, outputIdPrefix = "" }) {
    const response = await fetchWithRetry(audioUrl, undefined, { label: "火山音频下载" });
    if (!response.ok) {
      throw new Error(`下载音频失败：HTTP ${response.status}`);
    }
    const ext = format === "ogg_opus" ? "ogg" : format;
    const id = `${outputIdPrefix}${taskId}.${ext}`;
    const filePath = path.join(outputDir, id);
    const arrayBuffer = await response.arrayBuffer();
    await fs.writeFile(filePath, Buffer.from(arrayBuffer));
    return {
      id,
      path: filePath,
      url: `/data/doubao-voice-playground/${encodeURIComponent(id)}`,
      bytes: Buffer.byteLength(Buffer.from(arrayBuffer))
    };
  }

  function resolveResultFile(id) {
    if (!id || typeof id !== "string" || !/^[a-zA-Z0-9._-]+$/.test(id)) {
      throw new Error("音频 id 不合法");
    }
    const target = path.join(outputDir, id);
    const relative = path.relative(outputDir, target);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("音频路径不合法");
    }
    return target;
  }

  async function fetchWithRetry(url, options, { label, retries = 2 } = {}) {
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await fetch(url, options);
      } catch (error) {
        lastError = error;
        logger.warn?.(`${label || "请求"}失败，准备重试`, {
          attempt: attempt + 1,
          retries,
          message: error instanceof Error ? error.message : String(error)
        });
        if (attempt < retries) {
          await delay(1200 * (attempt + 1));
        }
      }
    }
    throw new Error(`${label || "请求"}连接失败，请稍后重试。${formatFetchError(lastError)}`);
  }
}

function buildHeaders(apiKey, resourceId) {
  const authorization = /^Bearer;/i.test(apiKey) ? apiKey : `Bearer; ${apiKey}`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: authorization
  };
  if (resourceId) {
    headers["Resource-Id"] = resourceId;
  }
  return headers;
}

function normalizeText(text) {
  if (!text || typeof text !== "string" || !text.trim()) {
    throw new Error("请输入要合成的文本");
  }
  if (text.length > 100000) {
    throw new Error("文本不能超过 100000 字符");
  }
  return text.trim();
}

function normalizeParams(input) {
  const format = String(input.format || "mp3");
  if (!ALLOWED_FORMATS.has(format)) {
    throw new Error("format 不支持");
  }
  const sampleRate = Number(input.sample_rate || 24000);
  if (!ALLOWED_SAMPLE_RATES.has(sampleRate)) {
    throw new Error("sample_rate 不支持");
  }
  return {
    endpoint: input.endpoint === "emotion" ? "emotion" : "normal",
    voice_type: String(input.voice_type || "BV009_streaming").trim(),
    format,
    sample_rate: sampleRate,
    speed: optionalNumber(input.speed),
    volume: optionalNumber(input.volume),
    pitch: optionalNumber(input.pitch),
    sentence_interval: optionalNumber(input.sentence_interval),
    local_sentence_pause: input.local_sentence_pause !== false,
    local_sentence_pause_min: clampNumber(input.local_sentence_pause_min, 0, 3, 0.45),
    local_sentence_pause_max: clampNumber(input.local_sentence_pause_max, 0, 3, 0.85),
    enable_subtitle: input.enable_subtitle ? 1 : 0,
    style: typeof input.style === "string" ? input.style.trim() : "",
    wait: input.wait !== false,
    timeout_seconds: clampNumber(input.timeout_seconds, 10, 600, 180),
    poll_interval_seconds: clampNumber(input.poll_interval_seconds, 1, 30, 3)
  };
}

function splitSentences(text) {
  const matches = text
    .replace(/\s+/g, " ")
    .trim()
    .match(/[^.!?。！？]+[.!?。！？]+["')\]]*|[^.!?。！？]+$/g);
  return (matches || [text])
    .map((item) => item.trim())
    .filter(Boolean);
}

function randomPause(min, max) {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return Number((low + Math.random() * (high - low)).toFixed(3));
}

function buildUniformPauses(count, min, max) {
  return Array.from({ length: Math.max(0, count) }, (_, index) => ({
    index: index + 1,
    duration: randomPause(min, max),
    weight: null,
    method: "uniform"
  }));
}

function buildWeightedPauses(sentences, min, max) {
  const pairs = [];
  for (let index = 0; index < sentences.length - 1; index += 1) {
    const before = sentenceWeightLength(sentences[index]);
    const after = sentenceWeightLength(sentences[index + 1]);
    pairs.push({
      index: index + 1,
      before_length: before,
      after_length: after,
      weighted_length: before * 0.82 + after * 0.18
    });
  }
  if (!pairs.length) return [];
  const weightedValues = pairs.map((pair) => pair.weighted_length);
  const shortest = Math.min(...weightedValues);
  const longest = Math.max(...weightedValues);
  return pairs.map((pair) => {
    const weight = longest === shortest
      ? 0.5
      : (pair.weighted_length - shortest) / (longest - shortest);
    const jitter = (Math.random() - 0.5) * 0.18;
    const shapedWeight = clampUnit(weight * 0.82 + 0.09 + jitter);
    const duration = Math.min(min, max) + shapedWeight * Math.abs(max - min);
    return {
      ...pair,
      duration: Number(duration.toFixed(3)),
      weight: Number(shapedWeight.toFixed(3)),
      method: "length_weighted"
    };
  });
}

function sentenceWeightLength(sentence) {
  const text = String(sentence || "").trim();
  const asciiWords = text.match(/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?/g) || [];
  const cjkChars = text.match(/[\u3400-\u9fff]/g) || [];
  const otherChars = text.replace(/[A-Za-z0-9\s.,!?;:'"()[\]{}，。！？；：、“”‘’（）【】]/g, "");
  return asciiWords.length + cjkChars.length + Math.ceil(otherChars.length / 2);
}

function clampUnit(value) {
  return Math.min(1, Math.max(0, value));
}

async function concatAudioWithPauses({ inputPaths, pauses, outputPath, workDir }) {
  const concatEntries = [];
  for (let index = 0; index < inputPaths.length; index += 1) {
    concatEntries.push(inputPaths[index]);
    const pause = pauses[index];
    if (typeof pause === "number" && pause > 0) {
      const silencePath = path.join(workDir, `silence-${String(index + 1).padStart(2, "0")}.mp3`);
      await execFileAsync("ffmpeg", [
        "-y",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=24000:cl=mono",
        "-t",
        String(pause),
        "-c:a",
        "libmp3lame",
        "-b:a",
        "128k",
        silencePath
      ]);
      concatEntries.push(silencePath);
    }
  }

  const listPath = path.join(workDir, "concat.txt");
  await fs.writeFile(
    listPath,
    concatEntries.map((entry) => `file '${escapeConcatPath(entry)}'`).join("\n"),
    "utf8"
  );
  await execFileAsync("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c:a",
    "libmp3lame",
    "-b:a",
    "128k",
    outputPath
  ]);
}

function escapeConcatPath(value) {
  return String(value).replaceAll("'", "'\\''");
}

function optionalNumber(value) {
  if (value === "" || value === null || value === undefined) {
    return undefined;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return undefined;
  }
  return number;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

function assignOptionalNumber(target, key, value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    target[key] = value;
  }
}

function sanitizeResponse(value) {
  if (!value || typeof value !== "object") {
    return value;
  }
  return JSON.parse(JSON.stringify(value, (key, innerValue) => {
    if (/authorization|api[-_]?key|appid|app_id|token|secret|audio_url|audioUrl|url/i.test(key)) {
      return "[redacted]";
    }
    return innerValue;
  }));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatFetchError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  const cause = error?.cause?.code || error?.cause?.message || "";
  if (/timeout|UND_ERR_CONNECT_TIMEOUT/i.test(`${message} ${cause}`)) {
    return "原因：连接超时。";
  }
  return message ? `原因：${message}` : "";
}
