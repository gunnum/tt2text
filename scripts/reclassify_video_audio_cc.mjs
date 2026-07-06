import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveDataDir, resolveLocalTmpDir } from "./local-storage.mjs";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const dryRun = !process.argv.includes("--write");
const dataDir = resolveDataDir(process.env);
const outputDir = path.join(resolveLocalTmpDir(process.env), "audio-cc-reclassify");

const sources = [
  {
    key: "ad-shots",
    file: path.join(dataDir, "ad-shots.json"),
    kind: "adShot"
  },
  {
    key: "results",
    file: path.join(dataDir, "results.json"),
    kind: "normalResult"
  }
];

const summary = {
  dryRun,
  generatedAt: new Date().toISOString(),
  totals: {
    scanned: 0,
    changed: 0,
    markedBgm: 0,
    markedSpeech: 0,
    metadataFound: 0,
    metadataMissing: 0,
    skippedNoAudioSignal: 0,
    skippedExistingManual: 0
  },
  bySource: {},
  changed: [],
  skipped: []
};

await fs.mkdir(outputDir, { recursive: true });

for (const source of sources) {
  const items = JSON.parse(await fs.readFile(source.file, "utf8"));
  const sourceSummary = {
    scanned: items.length,
    changed: 0,
    markedBgm: 0,
    markedSpeech: 0,
    metadataFound: 0,
    metadataMissing: 0,
    skippedNoAudioSignal: 0,
    skippedExistingManual: 0
  };
  summary.bySource[source.key] = sourceSummary;

  for (const item of items) {
    summary.totals.scanned += 1;
    const decision = await classifyItem(item, source.kind);
    if (decision.metadataFound) {
      sourceSummary.metadataFound += 1;
      summary.totals.metadataFound += 1;
    } else {
      sourceSummary.metadataMissing += 1;
      summary.totals.metadataMissing += 1;
    }

    if (decision.skipReason) {
      sourceSummary[decision.skipReason] = (sourceSummary[decision.skipReason] || 0) + 1;
      summary.totals[decision.skipReason] = (summary.totals[decision.skipReason] || 0) + 1;
      summary.skipped.push(toReportItem(source.key, item, decision));
      continue;
    }

    if (!decision.changed) {
      continue;
    }

    applyDecision(item, decision);
    sourceSummary.changed += 1;
    summary.totals.changed += 1;
    if (decision.audioKind === "bgm") {
      sourceSummary.markedBgm += 1;
      summary.totals.markedBgm += 1;
    } else {
      sourceSummary.markedSpeech += 1;
      summary.totals.markedSpeech += 1;
    }
    summary.changed.push(toReportItem(source.key, item, decision));
  }

  if (!dryRun) {
    await fs.writeFile(source.file, JSON.stringify(items, null, 2) + "\n", "utf8");
  }
}

const summaryPath = path.join(outputDir, dryRun ? "dry-run-summary.json" : "write-summary.json");
await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ summaryPath, totals: summary.totals, bySource: summary.bySource }, null, 2));

async function classifyItem(item, sourceKind) {
  const existingKind = normalizeText(item.audioKind || item.audioType || item.audio_kind || item.audio_type || item.raw?.audioKind).toLowerCase();
  const existingBgm = existingKind === "bgm" || item.bgmOnly === true || item.isBgmOnly === true;
  const metadata = await readMetadata(item, sourceKind);
  const musicTrack = normalizeMusicTrack(firstText(item.musicTrack, item.bgmTitle, item.musicTitle, item.raw?.musicTrack, item.raw?.track, metadata.track, metadata.musicTrack, metadata.title));
  const musicArtist = firstText(item.musicArtist, item.raw?.musicArtist, item.raw?.artist, metadata.artist, Array.isArray(metadata.artists) ? metadata.artists[0] : "", metadata.uploader, metadata.channel);
  const musicArtists = Array.from(new Set([
    ...(Array.isArray(item.musicArtists) ? item.musicArtists : []),
    ...(Array.isArray(item.raw?.musicArtists) ? item.raw.musicArtists : []),
    ...(Array.isArray(metadata.artists) ? metadata.artists : []),
    musicArtist
  ].map(normalizeText).filter(Boolean)));
  const metadataFound = Boolean(Object.keys(metadata).length);
  const audioText = normalizeText(item.transcriptEn || item.transcriptOriginal || item.transcript_origin || item.transcript_en);
  const audioZh = normalizeText(item.transcriptZh || item.transcript_zh);
  const analysis = item.analysisSummary && typeof item.analysisSummary === "object"
    ? item.analysisSummary
    : item.analysis && typeof item.analysis === "object"
      ? item.analysis
      : {};
  const evidenceText = normalizeText([
    item.title,
    audioText,
    audioZh,
    item.visualSummary,
    item.storySummary,
    analysis.script,
    analysis.videoStory,
    analysis.cardSummary,
    analysis.onScreenTextOriginal,
    analysis.onScreenTextZh
  ].join(" "));

  const hasMetadataMusic = Boolean(musicTrack || musicArtist);
  const noSpeechSignal = hasNoSpeechSignal(evidenceText);
  const lyricSignal = hasLyricLikeSignal(audioText, audioZh, evidenceText, metadata);
  const speechSignal = hasSpeechSignal(audioText, audioZh);
  const shouldMarkBgm = existingBgm || (hasMetadataMusic && (noSpeechSignal || lyricSignal) && !speechSignal);

  if (!hasMetadataMusic && !existingBgm) {
    return { metadataFound, skipReason: "skippedNoAudioSignal", reason: "no metadata music or existing bgm marker" };
  }

  if (!shouldMarkBgm) {
    return {
      metadataFound,
      skipReason: "skippedNoAudioSignal",
      reason: "speech or unclear audio; leave current CC untouched",
      signals: { noSpeechSignal, lyricSignal, speechSignal },
      musicTrack,
      musicArtist,
      musicArtists
    };
  }

  const nextKind = "bgm";
  const changed = needsChange(item, nextKind, musicTrack, musicArtist, musicArtists);
  if (!changed) {
    return {
      metadataFound,
      audioKind: nextKind,
      musicTrack,
      musicArtist,
      musicArtists,
      changed: false,
      reason: "already bgm",
      signals: { noSpeechSignal, lyricSignal, speechSignal }
    };
  }

  return {
    metadataFound,
    audioKind: nextKind,
    bgmOnly: shouldMarkBgm,
    musicTrack,
    musicArtist,
    musicArtists,
    changed: true,
    reason: "metadata music + no-speech/lyric signal",
    signals: { noSpeechSignal, lyricSignal, speechSignal }
  };
}

function applyDecision(item, decision) {
  item.audioKind = decision.audioKind;
  item.bgmOnly = decision.audioKind === "bgm";
  item.musicTrack = decision.musicTrack || "";
  item.musicArtist = decision.musicArtist || "";
  item.musicArtists = decision.musicArtists || [];
  item.raw = item.raw && typeof item.raw === "object" ? item.raw : {};
  item.raw.audioKind = item.audioKind;
  item.raw.bgmOnly = item.bgmOnly;
  item.raw.musicTrack = item.musicTrack;
  item.raw.musicArtist = item.musicArtist;
  item.raw.musicArtists = item.musicArtists;
  for (const key of ["analysisSummary", "analysis"]) {
    if (item[key] && typeof item[key] === "object") {
      item[key].audioKind = item.audioKind;
      item[key].bgmOnly = item.bgmOnly;
      item[key].musicTrack = item.musicTrack;
      item[key].musicArtist = item.musicArtist;
    }
  }
}

function needsChange(item, nextKind, musicTrack, musicArtist, musicArtists) {
  const currentKind = normalizeText(item.audioKind || item.audioType || item.raw?.audioKind).toLowerCase();
  if (currentKind !== nextKind) return true;
  if ((nextKind === "bgm") !== (item.bgmOnly === true)) return true;
  if (normalizeText(item.musicTrack || item.raw?.musicTrack) !== normalizeText(musicTrack)) return true;
  if (normalizeText(item.musicArtist || item.raw?.musicArtist) !== normalizeText(musicArtist)) return true;
  const currentArtists = JSON.stringify(Array.isArray(item.musicArtists) ? item.musicArtists.map(normalizeText).filter(Boolean) : []);
  const nextArtists = JSON.stringify((musicArtists || []).map(normalizeText).filter(Boolean));
  return currentArtists !== nextArtists;
}

async function readMetadata(item, sourceKind) {
  const candidates = metadataCandidates(item, sourceKind);
  for (const candidate of candidates) {
    try {
      return JSON.parse(await fs.readFile(candidate, "utf8"));
    } catch {
      // Try next path.
    }
  }
  return {};
}

function metadataCandidates(item, sourceKind) {
  const paths = [];
  const videoPath = firstText(item.videoPath, item.media?.videoPath, item.localVideoPath, item.local_video_path);
  const firstFramePath = firstText(item.firstFramePath, item.media?.firstFramePath, item.posterPath, item.media?.posterPath);
  if (sourceKind === "adShot") {
    const shotId = firstText(item.shotId, item.id);
    if (shotId) paths.push(path.join(dataDir, "ad-shots", shotId, "analysis", "metadata.json"));
    if (videoPath) paths.push(publicPathToLocal(videoPath).replace(/\/[^/]*$/, "/metadata.json"));
  } else {
    const jobId = firstText(item.id, item.jobId, item.job_id);
    if (jobId) {
      paths.push(path.join(dataDir, "jobs", jobId, "metadata.json"));
      paths.push(path.join(dataDir, "jobs", jobId, "video.info.json"));
    }
    if (firstFramePath) paths.push(publicPathToLocal(firstFramePath).replace(/\/[^/]*$/, "/metadata.json"));
    if (videoPath) paths.push(publicPathToLocal(videoPath).replace(/\/[^/]*$/, "/metadata.json"));
  }
  return Array.from(new Set(paths.filter(Boolean)));
}

function hasNoSpeechSignal(text) {
  return /没有(?:有效)?口播|无(?:有效)?口播|没有人声|无人声|只有\s*bgm|只有背景音乐|音频为\s*bgm|音频是\s*bgm|主要信息由画面|信息主要来自画面|没有检测到可转写|未检测到可转写/i.test(text);
}

function hasLyricLikeSignal(en, zh, evidence, metadata) {
  const text = normalizeText([en, zh].join(" "));
  if (!text) return false;
  const shortAudio = text.length > 0 && text.length <= 160;
  const musicMetadata = Boolean(firstText(metadata.track, metadata.artist, Array.isArray(metadata.artists) ? metadata.artists[0] : ""));
  const explicit = /歌词|疑似歌词|像歌词|lyrics?|song|music|background music|bgm|配合音乐|背景音乐|音乐氛围/i.test(evidence);
  const repeatedFragment = /\b(la|na|oh|yeah|baby|hey)\b/i.test(en) || /(啦|啊|哦|耶|宝贝)/.test(zh);
  return musicMetadata && shortAudio && (explicit || repeatedFragment || !hasConversationalShape(en, zh));
}

function hasSpeechSignal(en, zh) {
  const text = normalizeText([en, zh].join(" "));
  if (!text) return false;
  return text.length >= 220 && hasConversationalShape(en, zh);
}

function normalizeMusicTrack(value) {
  const text = normalizeText(value);
  if (!text) return "";
  if (/^(video|audio|sound|music)$/i.test(text)) return "";
  return text;
}

function hasConversationalShape(en, zh) {
  const text = normalizeText([en, zh].join(" "));
  return /\b(i|you|we|my|your|this|that|app|download|try|use|get|found|called|because|actually|if|when|how|what)\b/i.test(en)
    || /(我|你|我们|这个|那个|下载|使用|试试|因为|如果|怎么|什么|叫|发现|可以|就是)/.test(zh)
    || /[?？]/.test(text);
}

function toReportItem(source, item, decision) {
  return {
    source,
    id: item.shotId || item.id || "",
    title: normalizeText(item.title).slice(0, 140),
    audioKind: decision.audioKind || normalizeText(item.audioKind),
    musicTrack: decision.musicTrack || normalizeText(item.musicTrack),
    musicArtist: decision.musicArtist || normalizeText(item.musicArtist),
    reason: decision.reason || decision.skipReason || "",
    signals: decision.signals || {},
    transcriptEn: normalizeText(item.transcriptEn || item.transcriptOriginal).slice(0, 220),
    transcriptZh: normalizeText(item.transcriptZh).slice(0, 220)
  };
}

function publicPathToLocal(value) {
  const text = normalizeText(value);
  if (!text) return "";
  if (path.isAbsolute(text) && !text.startsWith("/data/")) return text;
  if (text.startsWith("/data/")) return path.join(dataDir, text.replace(/^\/data\/?/, ""));
  return path.join(projectRoot, text.replace(/^\//, ""));
}

function firstText(...items) {
  for (const item of items) {
    const text = normalizeText(item);
    if (text) return text;
  }
  return "";
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
