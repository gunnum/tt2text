import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function createFishAudioVoiceService({ outputDir, logger = console } = {}) {
  if (!outputDir) {
    throw new Error("createFishAudioVoiceService 缺少 outputDir");
  }

  async function generate(input = {}) {
    const text = input.text || "";
    // Default fallback voice reference ID (e.g. Nancy or another default female US English voice)
    const voiceType = input.voice_type || "fbe02f8306fc4d3d915e9871722a39d5";
    const credentials = await readCredentials();
    await fs.mkdir(outputDir, { recursive: true });

    const reqid = randomUUID();
    const filename = `${reqid}.mp3`;
    const filePath = path.join(outputDir, filename);

    const body = {
      text,
      format: input.format || "mp3",
      sample_rate: input.sample_rate || 44100,
      normalize: input.normalize ?? true,
      latency: input.latency || "normal",
      prosody: {
        speed: input.speed ?? 1.0,
        volume: input.volume ?? 1.0
      }
    };

    if (voiceType) {
      body.reference_id = voiceType;
    }

    const model = input.model || "s2.1-pro-free";
    await writeFishAudioFileWithPython({
      apiKey: credentials.apiKey,
      body,
      model,
      filePath
    });

    const stat = await fs.stat(filePath);

    return {
      ok: true,
      reqid,
      task_id: reqid,
      file: {
        id: filename,
        path: filePath,
        url: `/data/doubao-voice-playground/${encodeURIComponent(filename)}`,
        bytes: stat.size
      }
    };
  }

  async function writeFishAudioFileWithPython({ apiKey, body, model, filePath }) {
    const script = String.raw`
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

payload = json.loads(sys.argv[1])
api_key = os.environ.get("FISH_AUDIO_API_KEY", "")
if not api_key:
    print("missing Fish Audio API key", file=sys.stderr)
    sys.exit(2)

body = json.dumps(payload["body"]).encode("utf-8")
req = urllib.request.Request(
    "https://api.fish.audio/v1/tts",
    data=body,
    headers={
        "Authorization": "Bearer " + api_key,
        "Content-Type": "application/json",
        "model": payload["model"]
    },
    method="POST"
)

try:
    with urllib.request.urlopen(req, timeout=90) as resp:
        data = resp.read()
        pathlib.Path(payload["filePath"]).write_bytes(data)
except urllib.error.HTTPError as error:
    detail = error.read(1000).decode("utf-8", errors="replace")
    print(f"Fish Audio API error (HTTP {error.code}): {detail}", file=sys.stderr)
    sys.exit(1)
except Exception as error:
    print(f"Fish Audio request failed: {type(error).__name__}: {error}", file=sys.stderr)
    sys.exit(1)
`;

    try {
      await execFileAsync("python3", ["-c", script, JSON.stringify({ body, model, filePath })], {
        env: {
          ...process.env,
          FISH_AUDIO_API_KEY: apiKey
        },
        maxBuffer: 1024 * 1024
      });
    } catch (error) {
      const stderr = error?.stderr?.trim();
      throw new Error(stderr || error?.message || "Fish Audio request failed");
    }
  }

  async function readCredentials() {
    const apiKey = await readKeychainValue("api-key");
    if (!apiKey) {
      throw new Error("Keychain 中缺少 Fish Audio 凭证 (service: fish-audio-voice, account: api-key)");
    }
    return { apiKey };
  }

  async function readKeychainValue(account) {
    try {
      const { stdout } = await execFileAsync("security", [
        "find-generic-password",
        "-a",
        account,
        "-s",
        "fish-audio-voice",
        "-w"
      ]);
      return stdout.trim();
    } catch (e) {
      return null;
    }
  }

  return {
    generate
  };
}
