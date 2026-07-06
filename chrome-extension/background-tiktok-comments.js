export async function collectTikTokVideoComments(tabId, expandCount) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [expandCount],
    func: async (requestedExpandCount) => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const normalizeText = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const sourceUrl = location.href.split("?")[0].replace(/\/$/, "");
      const overlayId = "tt2text-import-overlay";
      const MAX_INLINE_IMAGE_BYTES = 2_500_000;
      const updateOverlay = (title, message) => {
        let overlay = document.getElementById(overlayId);
        if (!overlay) {
          overlay = document.createElement("div");
          overlay.id = overlayId;
          overlay.style.cssText = "position:fixed;right:18px;top:84px;z-index:2147483647;width:330px;padding:16px;border-radius:18px;box-shadow:0 18px 60px rgba(0,0,0,.22);background:#fffaf2;color:#1f1c18;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;border:1px solid rgba(45,35,23,.14)";
          document.documentElement.appendChild(overlay);
        }
        if (overlay.__tt2textDismissTimer) {
          window.clearTimeout(overlay.__tt2textDismissTimer);
          overlay.__tt2textDismissTimer = null;
        }
        overlay.innerHTML = `<div style="font-size:11px;font-weight:900;letter-spacing:.14em;color:#0d6f5b;text-transform:uppercase;">TT2TEXT COMMENTS</div><div style="margin-top:8px;font-size:18px;font-weight:900;">${title}</div><div style="margin-top:8px;font-size:13px;line-height:1.55;color:#6c6257;">${message}</div>`;
        if (title === "评论采集完成") {
          overlay.__tt2textDismissTimer = window.setTimeout(() => {
            overlay.remove();
          }, 5000);
        }
      };

      function getRightPanel() {
        const firstComment = document.querySelector("[data-e2e='comment-level-1']");
        const directCommentRoot = [
          firstComment?.closest("[class*='RightPanelContainer'], [class*='RightPanel'], aside, section"),
          firstComment?.closest("[class*='DivContentContainer']")
        ].find((node) => {
          return node && node.querySelectorAll?.("[data-e2e='comment-level-1']").length > 1;
        });
        if (directCommentRoot) {
          return directCommentRoot;
        }
        const tabbar = document.querySelector("[data-testid='tux-tabbar'], [data-testid='tux-web-tab-bar']")?.closest("[data-testid='tux-tabbar'], [class*='tux-tabbar'], [class*='RightPanel'], [class*='RightPanelContainer']")
          || document.querySelector("[data-testid='tux-web-tab-bar']")?.parentElement
          || document.querySelector("[data-testid='tux-tabbar']");
        if (tabbar) {
          const container = tabbar.closest("[class*='RightPanelContainer'], [class*='RightPanel'], [class*='DivContentContainer']")
            || tabbar.parentElement?.parentElement
            || tabbar.parentElement
            || tabbar;
          return container;
        }
        const candidates = Array.from(document.querySelectorAll("[class*='RightPanelContainer'], [class*='RightPanel'], aside, [class*='DivContentContainer']"));
        return candidates
          .filter((node) => node.getBoundingClientRect().left > window.innerWidth * 0.45)
          .sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left)[0]
          || document.body;
      }

      function getCommentScrollTop(node) {
        if (!node || node === document.body || node === document.documentElement || node === document.scrollingElement) {
          return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
        }
        return node.scrollTop;
      }

      function getCommentScrollMax(node) {
        if (!node || node === document.body || node === document.documentElement || node === document.scrollingElement) {
          const element = document.scrollingElement || document.documentElement;
          return Math.max(0, (element?.scrollHeight || 0) - window.innerHeight);
        }
        return Math.max(0, node.scrollHeight - node.clientHeight);
      }

      function setCommentScrollTop(node, top) {
        if (!node || node === document.body || node === document.documentElement || node === document.scrollingElement) {
          window.scrollTo(0, top);
          return;
        }
        node.scrollTop = top;
      }

      function findCommentScrollContainer(panel) {
        const commentBody = panel?.querySelector?.("[data-e2e='comment-level-1']") || document.querySelector("[data-e2e='comment-level-1']");
        let node = commentBody?.parentElement || panel;
        while (node) {
          const style = node instanceof Element ? getComputedStyle(node) : null;
          const isScrollable = (node.scrollHeight || 0) > (node.clientHeight || 0) + 120;
          const overflowY = style?.overflowY || "";
          if (isScrollable && /auto|scroll|overlay/i.test(overflowY || "")) {
            return node;
          }
          if (node === panel) {
            break;
          }
          node = node.parentElement;
        }
        const candidates = Array.from((panel || document).querySelectorAll?.("div, section, aside, main") || [])
          .filter((element) => (element.scrollHeight || 0) > (element.clientHeight || 0) + 120)
          .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight));
        return candidates[0] || document.scrollingElement || document.documentElement;
      }

      function buildStructuredCommentEntries(scope) {
        const buildItemsForLevel = (level) => {
          const authorNodes = Array.from(scope.querySelectorAll(`[data-e2e='comment-username-${level}']`));
          const bodyNodes = Array.from(scope.querySelectorAll(`[data-e2e='comment-level-${level}']`));
          const timeNodes = Array.from(scope.querySelectorAll(`[data-e2e='comment-time-${level}']`));
          const likeNodes = Array.from(scope.querySelectorAll(`[data-e2e='comment-like-count']`));
          const replyNodes = Array.from(scope.querySelectorAll(`[data-e2e='comment-reply-${level}']`));

          return bodyNodes.map((bodyNode, index) => {
            const author = normalizeText(authorNodes[index]?.textContent || "");
            const text = normalizeText(bodyNode.textContent || "");
            const timeText = normalizeText(timeNodes[index]?.textContent || "");
            const likeText = normalizeText(likeNodes[index]?.textContent || "");
            const rawText = normalizeText([
              author,
              text,
              timeText,
              normalizeText(replyNodes[index]?.textContent || ""),
              likeText
            ].filter(Boolean).join("\n"));
            if (!text || /^系统通知TikTok/i.test(text)) {
              return null;
            }
            return {
              author,
              text,
              likeText,
              replyCountText: "",
              timeText,
              rawText,
              media: collectCommentMedia(bodyNode.closest("[data-e2e='comment-item'], [class*='CommentItem'], [class*='DivCommentItemContainer']") || bodyNode),
              level
            };
          }).filter(Boolean);
        };

        return [
          ...buildItemsForLevel(1),
          ...buildItemsForLevel(2)
        ];
      }

      function getCommentRoots(scope) {
        const scopedRoots = [
          ...Array.from(scope?.querySelectorAll?.("[data-e2e='comment-item'], [data-e2e*='comment-level'], [class*='CommentItem'], [class*='DivCommentItemContainer']") || []),
          ...Array.from(scope?.querySelectorAll?.("div") || []).filter((node) => {
            const text = normalizeText(node.innerText || node.textContent || "");
            return Boolean(node.querySelector?.("img"))
              && /回复|Reply|reply|^\d{4}-\d{1,2}-\d{1,2}|^\d{1,2}-\d{1,2}/m.test(text)
              && text.length >= 8
              && text.length <= 900;
          })
        ];
        const candidates = scopedRoots.length ? scopedRoots : Array.from(document.querySelectorAll("[data-e2e='comment-item'], [class*='CommentItem']"));
        return Array.from(new Set(candidates)).filter((node) => {
          const text = normalizeText(node.innerText || node.textContent || "");
          return text.length >= 3
            && text.length <= 900
            && !/^(comments?|评论)$/.test(text.toLowerCase())
            && !/^\d+$/.test(text)
            && !/^系统通知TikTok/i.test(text)
            && !text.includes("TT2TEXT COMMENTS");
        });
      }

      function parseComment(root) {
        const rawText = normalizeText(root.innerText || root.textContent || "");
        const media = collectCommentMedia(root);
        if ((!rawText && !media.length) || /^\d+$/.test(rawText) || /^系统通知TikTok/i.test(rawText)) {
          return null;
        }
        const lines = rawText.split(/\n+/).map(normalizeText).filter(Boolean);
        const author = lines.find((line) => {
          return line.length >= 2
            && line.length <= 50
            && !/^(回复|Reply|like|likes?|查看|more|Creator|作者|评论|猜你喜欢)$/i.test(line)
            && !/^\d+$/.test(line)
            && !/\d{4}-\d{1,2}-\d{1,2}/.test(line);
        }) || "";
        const commentLine = lines.find((line) => {
          if (line === author) {
            return false;
          }
          if (/^(like|likes?|reply|replies|回复|查看|more|creator|作者)$/i.test(line)) {
            return false;
          }
          if (/^\d+$/.test(line) || /^\d{4}-\d{1,2}-\d{1,2}$/.test(line) || /^\d{1,2}-\d{1,2}$/.test(line)) {
            return false;
          }
          return line.length >= 2 && line.length <= 500;
        }) || "";
        if ((!commentLine || commentLine === author) && !media.length) {
          return null;
        }
        const likeMatch = rawText.match(/\b(\d+(?:\.\d+)?[KMB万千]?)\s*(?:likes?|赞|like)\b/i);
        const replyMatch = rawText.match(/\b(\d+(?:\.\d+)?[KMB万千]?)\s*(?:repl(?:y|ies)|回复)\b/i);
        const timeMatch = rawText.match(/\b(?:\d+\s*(?:秒|分钟|小时|天|周|月|年|s|m|h|d|w|mo|y)|\d{1,2}-\d{1,2}|20\d{2}-\d{1,2}-\d{1,2})\b/i);
        return {
          author,
          text: commentLine,
          likeText: likeMatch?.[1] || "",
          replyCountText: replyMatch?.[1] || "",
          timeText: timeMatch?.[0] || "",
          rawText,
          media
        };
      }

      function collectCommentMedia(root) {
        const images = Array.from(root?.querySelectorAll?.("img") || []);
        const seen = new Set();
        return images.map((image) => {
          const sourceUrl = normalizeImageUrl(image.currentSrc || image.src || image.getAttribute("src") || "");
          if (!sourceUrl || seen.has(sourceUrl) || !isLikelyUserCommentImage(image, root)) {
            return null;
          }
          seen.add(sourceUrl);
          const rect = image.getBoundingClientRect();
          return {
            type: "image",
            sourceUrl,
            alt: normalizeText(image.alt || image.getAttribute("aria-label") || ""),
            width: Math.round(image.naturalWidth || rect.width || 0),
            height: Math.round(image.naturalHeight || rect.height || 0)
          };
        }).filter(Boolean).slice(0, 4);
      }

      function isLikelyUserCommentImage(image, root) {
        const rect = image.getBoundingClientRect();
        const width = Math.max(Number(image.naturalWidth) || 0, rect.width || 0);
        const height = Math.max(Number(image.naturalHeight) || 0, rect.height || 0);
        const alt = normalizeText(image.alt || image.getAttribute("aria-label") || "").toLowerCase();
        const src = String(image.currentSrc || image.src || "").toLowerCase();
        if (!width || !height) {
          return false;
        }
        if (/(avatar|profile|emoji|verified|music|icon|logo|sticker|用户头像|头像)/i.test(alt)) {
          return false;
        }
        if (/(avatar|tos-maliva-avt|profile|emoji|icon)/i.test(src)) {
          return false;
        }
        if (width < 92 || height < 92) {
          return false;
        }
        const ratio = width / height;
        if (width <= 96 && height <= 96 && ratio > 0.75 && ratio < 1.35) {
          return false;
        }
        const rootRect = root?.getBoundingClientRect?.();
        if (rootRect && (rect.width > rootRect.width * 0.92 || rect.height > Math.max(900, rootRect.height * 2))) {
          return false;
        }
        const profileLink = image.closest?.("a[href*='@'], a[href*='/photo/'], a[href*='/video/']");
        if (profileLink?.href && /tiktok\.com\/@[^/]+\/?$/.test(profileLink.href)) {
          return false;
        }
        return true;
      }

      function normalizeImageUrl(value) {
        const text = String(value || "").trim();
        if (!/^https?:\/\//i.test(text)) {
          return "";
        }
        try {
          const url = new URL(text, location.href);
          url.hash = "";
          return url.toString();
        } catch {
          return text;
        }
      }

      function collectVisibleComments(scope) {
        const structuredItems = buildStructuredCommentEntries(scope);
        const items = [...structuredItems];
        const seenStructuredText = new Set(structuredItems.map((item) => normalizeText(item.text).toLowerCase()).filter(Boolean));
        for (const root of getCommentRoots(scope)) {
          const item = parseComment(root);
          if (item?.text || item?.media?.length) {
            const textKey = normalizeText(item.text).toLowerCase();
            if (!item.author && seenStructuredText.has(textKey)) {
              continue;
            }
            items.push(item);
          }
        }
        return items;
      }

      function getCommentKey(item) {
        return [
          normalizeText(item.author).toLowerCase(),
          normalizeText(item.timeText).toLowerCase(),
          normalizeText(item.text).toLowerCase()
        ].join("::");
      }

      function mergeCommentItems(scope, sink) {
        for (const item of collectVisibleComments(scope)) {
          const key = getCommentKey(item);
          if (!key || sink.has(key)) {
            continue;
          }
          sink.set(key, item);
        }
      }

      async function hydrateCommentMediaDataUrls(items) {
        const output = [];
        let inlined = 0;
        for (const item of items) {
          if (!item.media?.length) {
            output.push(item);
            continue;
          }
          const media = [];
          for (const mediaItem of item.media) {
            if (inlined >= 12) {
              media.push(mediaItem);
              continue;
            }
            const withDataUrl = await fetchImageDataUrl(mediaItem).catch(() => null);
            if (withDataUrl?.dataUrl) {
              inlined += 1;
              media.push(withDataUrl);
            } else {
              media.push(mediaItem);
            }
          }
          output.push({ ...item, media });
        }
        return output;
      }

      async function fetchImageDataUrl(mediaItem) {
        if (!mediaItem?.sourceUrl) {
          return null;
        }
        const response = await fetch(mediaItem.sourceUrl, { credentials: "include", cache: "force-cache" });
        if (!response.ok) {
          return null;
        }
        const blob = await response.blob();
        if (!blob.type.startsWith("image/") || blob.size > MAX_INLINE_IMAGE_BYTES) {
          return null;
        }
        const dataUrl = await blobToDataUrl(blob);
        return {
          ...mediaItem,
          dataUrl,
          bytes: blob.size,
          contentType: blob.type
        };
      }

      function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => reject(reader.error || new Error("读取图片失败"));
          reader.readAsDataURL(blob);
        });
      }

      async function collectAllFirstLevelComments(scope) {
        const scrollContainer = findCommentScrollContainer(scope);
        const step = Math.max(260, Math.floor((scrollContainer?.clientHeight || window.innerHeight || 800) * 0.8));
        const sink = new Map();

        const collectStep = () => {
          mergeCommentItems(scope, sink);
          return sink.size;
        };

        collectStep();
        let upwardPass = 0;
        while (getCommentScrollTop(scrollContainer) > 4 && upwardPass < 30) {
          upwardPass += 1;
          const nextTop = Math.max(0, getCommentScrollTop(scrollContainer) - step);
          setCommentScrollTop(scrollContainer, nextTop);
          await sleep(260);
          collectStep();
          if (nextTop <= 0) {
            break;
          }
        }

        setCommentScrollTop(scrollContainer, 0);
        await sleep(260);
        collectStep();

        let downwardPass = 0;
        let stalledRounds = 0;
        while (downwardPass < 120) {
          downwardPass += 1;
          const beforeTop = getCommentScrollTop(scrollContainer);
          const beforeSize = sink.size;
          const maxTop = getCommentScrollMax(scrollContainer);
          if (beforeTop >= maxTop - 4) {
            break;
          }
          setCommentScrollTop(scrollContainer, Math.min(maxTop, beforeTop + step));
          await sleep(320);
          const afterSize = collectStep();
          const afterTop = getCommentScrollTop(scrollContainer);
          if (afterTop <= beforeTop + 4 && afterSize === beforeSize) {
            stalledRounds += 1;
          } else {
            stalledRounds = 0;
          }
          if (afterTop >= getCommentScrollMax(scrollContainer) - 4 && afterSize === beforeSize) {
            break;
          }
          if (stalledRounds >= 3) {
            break;
          }
        }

        return hydrateCommentMediaDataUrls(Array.from(sink.values()));
      }

      updateOverlay("读取评论区", "会自动遍历当前评论区，累计已加载评论和可见回复。");
      await sleep(120);
      const actualExpandCount = 0;
      const panel = getRightPanel();
      const items = await collectAllFirstLevelComments(panel);
      updateOverlay("评论采集完成", `准备写入本地：${items.length} 条评论。`);
      return {
        sourceUrl,
        requestedExpandCount: 0,
        actualExpandCount,
        items
      };
    }
  });

  return {
    sourceUrl: result?.sourceUrl || "",
    requestedExpandCount: result?.requestedExpandCount || 0,
    actualExpandCount: result?.actualExpandCount || 0,
    items: Array.isArray(result?.items) ? result.items : []
  };
}

export async function showTikTokOverlay(tabId, payload) {
  await chrome.scripting.executeScript({
    target: { tabId },
    args: [payload],
    func: (info) => {
      const overlayId = "tt2text-import-overlay";
      const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      })[char]);
      let overlay = document.getElementById(overlayId);
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = overlayId;
        overlay.style.cssText = "position:fixed;right:18px;top:84px;z-index:2147483647;width:310px;padding:16px;border-radius:18px;box-shadow:0 18px 60px rgba(0,0,0,.22);background:#fffaf2;color:#1f1c18;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;border:1px solid rgba(45,35,23,.14)";
        document.documentElement.appendChild(overlay);
      }
      if (overlay.__tt2textDismissTimer) {
        window.clearTimeout(overlay.__tt2textDismissTimer);
        overlay.__tt2textDismissTimer = null;
      }
      const color = info.state === "error" ? "#b6452f" : "#0d6f5b";
      overlay.innerHTML = `<div style="font-size:11px;font-weight:900;letter-spacing:.14em;color:${color};text-transform:uppercase;">TT2TEXT COLLECTOR</div><div style="margin-top:8px;font-size:18px;font-weight:900;">${escapeHtml(info.title)}</div><div style="margin-top:8px;font-size:13px;line-height:1.55;color:#6c6257;">${escapeHtml(info.message)}</div>`;
      if (info.state === "done") {
        overlay.__tt2textDismissTimer = window.setTimeout(() => {
          overlay.remove();
        }, 5000);
      }
    }
  });
}
