(() => {
  if (window.TT2TextTikTokCollector) {
    return;
  }

  const overlayId = "tt2text-import-overlay";

  window.TT2TextTikTokCollector = {
    collect
  };

  async function collect(options = {}) {
    const targetLimit = clamp(Number(options.limit) || 60, 1, 200);
    const minCoverCount = clamp(Number(options.minCoverCount) || targetLimit, 1, targetLimit);
    const searchQuery = normalizeText(options.query || "");
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const scrollLog = [];
    let idleRounds = 0;
    let lastSize = 0;
    let lastFingerprint = "";

    await clickRetryIfNeeded(sleep);
    updateOverlay("正在加载 TikTok 搜索", `搜索词：${searchQuery || ""}。先等页面加载到 ${targetLimit} 个候选，再从第一个开始采集。`);
    await waitForTikTokToRender(sleep, 2800);
    await waitForVisibleCovers(sleep, 2600);

    const maxRounds = Math.max(48, Math.ceil(targetLimit * 1.8));
    const minRounds = Math.min(18, Math.max(10, Math.ceil(targetLimit / 4)));

    for (let round = 0; round < maxRounds && getLoadedPostCount() < targetLimit; round += 1) {
      const loadedCount = getLoadedPostCount();

      const before = getScrollSnapshot();
      updateOverlay(
        "正在加载 TikTok 搜索",
        `页面已加载 ${loadedCount}/${targetLimit} 条。第 ${round + 1} 轮滚动中；加载够后会回到顶部从第一个采集。`
      );

      await forceScrollRound(round, sleep);
      await waitForTikTokToRender(sleep, round < 8 ? 2400 : 1700);

      const after = getScrollSnapshot();
      const nextLoadedCount = getLoadedPostCount();
      const fingerprint = `${after.top}:${after.height}:${after.targets}:${nextLoadedCount}`;
      scrollLog.push({
        round: round + 1,
        found: nextLoadedCount,
        beforeTop: before.top,
        afterTop: after.top,
        beforeHeight: before.height,
        afterHeight: after.height,
        targets: after.targets
      });

      const didGrow = nextLoadedCount > loadedCount || after.height > before.height + 80;
      const didMove = after.top > before.top + 80;
      if (didGrow || nextLoadedCount !== lastSize || fingerprint !== lastFingerprint) {
        idleRounds = 0;
        lastSize = nextLoadedCount;
      } else {
        idleRounds += 1;
      }
      lastFingerprint = fingerprint;

      const pageLooksExhausted = isProbablyAtEnd() || !didMove;
      if (round >= 5 && idleRounds >= 4 && pageLooksExhausted && nextLoadedCount > 0) {
        updateOverlay(
          "没有更多搜索结果",
          `页面稳定在 ${nextLoadedCount} 条，已经接近底部或滚动不再增长；现在回到顶部采集当前结果。`,
          "done"
        );
        await sleep(900);
        break;
      }

      if (round >= minRounds && idleRounds >= 6 && nextLoadedCount > 0) {
        updateOverlay(
          "加载已稳定",
          `连续多轮没有新增结果，当前共 ${nextLoadedCount} 条；现在回到顶部采集。`,
          "done"
        );
        await sleep(900);
        break;
      }

      if (round >= minRounds && idleRounds >= 10 && isProbablyAtEnd()) {
        break;
      }

      await clickRetryIfNeeded(sleep);
    }

    await scrollToSearchTop(sleep);

    const loadedPostCount = getLoadedPostCount();
    const effectiveLimit = Math.max(1, Math.min(targetLimit, loadedPostCount || targetLimit));
    const effectiveMinCoverCount = Math.max(1, Math.min(minCoverCount, effectiveLimit));
    const seen = await collectLoadedItemsInVisualOrder({
      sleep,
      targetLimit: effectiveLimit,
      minCoverCount: effectiveMinCoverCount,
      requestedLimit: targetLimit
    });
    let coverCount = countCoveredItems(seen);
    if (coverCount < effectiveMinCoverCount) {
      const decision = await waitForCoverDecision({
        seen,
        sleep,
        targetLimit: effectiveLimit,
        minCoverCount: effectiveMinCoverCount
      });
      if (decision === "continue") {
        await continueWaitingForCovers({
          seen,
          sleep,
          targetLimit: effectiveLimit,
          minCoverCount: effectiveMinCoverCount
        });
      }
    }

    coverCount = countCoveredItems(seen);
    const items = Array.from(seen.values())
      .sort(compareVisualOrder)
      .filter((item) => item.coverUrl)
      .slice(0, effectiveLimit);
    updateOverlay("正在写入本地系统", `页面已加载 ${loadedPostCount} 条；按视觉顺序带回前 ${items.length} 条有封面的候选。`);
    return {
      items,
      diagnostics: {
        rounds: scrollLog.length,
        totalSeen: seen.size,
        returned: items.length,
        covers: coverCount,
        discardedNoCover: Math.max(0, seen.size - coverCount),
        firstReturned: items.slice(0, 8).map((item) => ({
          url: item.url,
          text: item.text,
          cover: Boolean(item.coverUrl),
          top: item.orderTop,
          left: item.orderLeft
        })),
        last: scrollLog.slice(-6),
        scroll: getScrollSnapshot()
      }
    };
  }

  function countCoveredItems(seen) {
    return Array.from(seen.values()).filter((item) => item.coverUrl).length;
  }

  function getLoadedPostCount() {
    return new Set(Array.from(document.querySelectorAll(getPostAnchorSelector())).map((anchor) => normalizePostUrl(anchor.href))).size;
  }

  async function scrollToSearchTop(sleep) {
    updateOverlay("回到搜索结果顶部", "候选数量已加载完成，正在回到顶部并按页面顺序采集。");
    const targets = getScrollableTargets();
    for (const target of targets) {
      if (target === window) {
        window.scrollTo({ top: 0, behavior: "auto" });
      } else {
        target.scrollTop = 0;
        target.dispatchEvent(new Event("scroll", { bubbles: true }));
      }
    }
    window.scrollTo({ top: 0, behavior: "auto" });
    await sleep(900);
    await waitForVisibleCovers(sleep, 2600);
  }

  async function collectLoadedItemsInVisualOrder({ sleep, targetLimit, minCoverCount, requestedLimit = targetLimit }) {
    const seen = new Map();
    const maxRounds = Math.max(24, Math.ceil(targetLimit / 3));
    let idleRounds = 0;
    let lastSeenSize = 0;
    let lastCoverCount = 0;
    for (let round = 0; round < maxRounds && (seen.size < targetLimit || countCoveredItems(seen) < minCoverCount); round += 1) {
      await waitForVisibleCovers(sleep, 2600);
      addSeenItems(seen);
      const covered = countCoveredItems(seen);
      updateOverlay(
        "正在按顺序采集",
        `已按页面顺序采集 ${seen.size}/${requestedLimit} 条，其中 ${covered}/${requestedLimit} 条有封面。`
      );
      if (seen.size >= targetLimit && covered >= minCoverCount) {
        break;
      }

      if (seen.size === lastSeenSize && covered === lastCoverCount) {
        idleRounds += 1;
      } else {
        idleRounds = 0;
        lastSeenSize = seen.size;
        lastCoverCount = covered;
      }

      if (round >= 4 && idleRounds >= 3 && isProbablyAtEnd() && covered > 0) {
        updateOverlay(
          "当前页面已采集完",
          `没有发现更多候选，准备带回 ${covered} 条有封面的结果。`,
          "done"
        );
        await sleep(700);
        break;
      }

      scrollAllTargets(Math.max(window.innerHeight * 0.72, 560));
      await waitForTikTokToRender(sleep, 1600);
    }
    return seen;
  }

  async function waitForCoverDecision({ seen, sleep, targetLimit, minCoverCount }) {
    updateCoverDecisionOverlay(seen, targetLimit, minCoverCount);
    const startedAt = Date.now();
    while (Date.now() - startedAt < 10 * 60 * 1000) {
      const action = window.TT2TextTikTokCollector.coverDecision;
      if (action === "return" || action === "continue") {
        window.TT2TextTikTokCollector.coverDecision = "";
        return action;
      }
      await waitForVisibleCovers(sleep, 1800);
      addSeenItems(seen);
      const coverCount = countCoveredItems(seen);
      if (coverCount >= minCoverCount) {
        return "ready";
      }
      updateCoverDecisionOverlay(seen, targetLimit, minCoverCount);
      await sleep(500);
    }
    return "return";
  }

  async function continueWaitingForCovers({ seen, sleep, targetLimit, minCoverCount }) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 90 * 1000 && countCoveredItems(seen) < minCoverCount) {
      updateOverlay(
        "继续等待封面加载",
        `已抓到 ${countCoveredItems(seen)}/${minCoverCount} 个封面。正在慢速等待 TikTok 补图...`
      );
      await waitForVisibleCovers(sleep, 2600);
      addSeenItems(seen);
      await sleep(800);
    }
  }

  function addSeenItems(seen) {
    for (const item of collectOnce()) {
      const key = normalizePostUrl(item.url);
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, {
          ...item,
          orderIndex: seen.size
        });
        continue;
      }
      if ((!existing.coverUrl && item.coverUrl) || isBetterCandidateText(item.text, existing.text)) {
        seen.set(key, {
          ...existing,
          ...item,
          text: isBetterCandidateText(item.text, existing.text) ? item.text : existing.text,
          coverUrl: item.coverUrl || existing.coverUrl
        });
      }
    }
  }

  function normalizePostUrl(url) {
    return String(url || "").split("?")[0].replace(/\/$/, "");
  }

  function isBetterCandidateText(nextText, currentText) {
    const next = normalizeText(nextText);
    const current = normalizeText(currentText);
    if (!next) {
      return false;
    }
    if (!current) {
      return true;
    }
    const nextLooksLikeStats = looksLikeStatsOnly(next);
    const currentLooksLikeStats = looksLikeStatsOnly(current);
    if (currentLooksLikeStats && !nextLooksLikeStats) {
      return true;
    }
    return next.length > current.length && !nextLooksLikeStats;
  }

  function looksLikeStatsOnly(text) {
    const value = normalizeText(text);
    if (!value) {
      return true;
    }
    const words = value.split(/\s+/);
    const numericLike = words.filter((word) => /^[\d.,KMB万千]+$/i.test(word) || /^(获赞最多|Replying|to)$/i.test(word)).length;
    return numericLike / Math.max(words.length, 1) > 0.68;
  }

  function collectOnce() {
    const anchors = Array.from(document.querySelectorAll(getPostAnchorSelector()));
    return anchors
      .map((anchor) => {
        const card = getVideoCard(anchor);
        const textSource = card && normalizeText(card.innerText || card.textContent || "").length > 10
          ? card
          : anchor;
        return {
          url: anchor.href,
          mediaType: getTikTokMediaType(anchor.href),
          text: normalizeText(textSource.innerText || textSource.textContent || "").slice(0, 1000),
          author: extractAuthor(anchor.href),
          coverUrl: extractCoverUrl(card || anchor),
          duration: extractDuration(card || anchor),
          engagement: extractEngagement(card || anchor),
          publishedText: extractPublishedText(card || anchor),
          publishedAt: normalizePublishedAt(extractPublishedText(card || anchor)),
          orderTop: getVisualTop(card || anchor),
          orderLeft: getVisualLeft(card || anchor)
        };
      })
      .filter((item) => item.url);
  }

  function compareVisualOrder(left, right) {
    const indexDelta = Number(left.orderIndex ?? 0) - Number(right.orderIndex ?? 0);
    if (indexDelta !== 0) {
      return indexDelta;
    }
    const topDelta = Number(left.orderTop || 0) - Number(right.orderTop || 0);
    if (Math.abs(topDelta) > 12) {
      return topDelta;
    }
    return Number(left.orderLeft || 0) - Number(right.orderLeft || 0);
  }

  function getVisualTop(node) {
    const rect = node?.getBoundingClientRect?.();
    return Math.round((rect?.top || 0) + (window.scrollY || 0));
  }

  function getVisualLeft(node) {
    const rect = node?.getBoundingClientRect?.();
    return Math.round((rect?.left || 0) + (window.scrollX || 0));
  }

  function getVideoCard(anchor) {
    const candidates = [];
    let node = anchor;
    for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
      candidates.push(node);
    }
    return candidates.find((candidate) => {
      const text = normalizeText(candidate.innerText || candidate.textContent || "");
      return candidate.querySelector?.(getPostAnchorSelector())
        && candidate.querySelector?.("img, video")
        && text.length > 10;
    }) || anchor.closest("[data-e2e], article, section, li") || anchor.parentElement || anchor;
  }

  function extractCoverUrl(card) {
    const roots = [
      card,
      card?.querySelector?.(getPostAnchorSelector()),
      card?.parentElement
    ].filter(Boolean);
    const source = roots
      .flatMap((root) => [
        ...Array.from(root?.querySelectorAll?.("img[src], img[data-src], img[srcset]") || []).map(readImageSource),
        ...Array.from(root?.querySelectorAll?.("video[poster]") || []).map((video) => video.getAttribute("poster"))
      ])
      .map(normalizeText)
      .find((url) => url && !url.startsWith("data:"))
      || "";
    return source;
  }

  function readImageSource(image) {
    const srcset = image.getAttribute("srcset") || "";
    const largestSrcset = srcset
      .split(",")
      .map((part) => part.trim().split(/\s+/)[0])
      .filter(Boolean)
      .pop();
    return image.currentSrc
      || image.getAttribute("src")
      || image.getAttribute("data-src")
      || largestSrcset
      || "";
  }

  function extractDuration(card) {
    const text = normalizeText(card?.innerText || card?.textContent || "");
    const match = text.match(/\b\d{1,2}:\d{2}\b/);
    return match ? match[0] : "";
  }

  function extractEngagement(card) {
    const text = normalizeText(card?.innerText || card?.textContent || "");
    const tokens = text.split(/\s+/).filter(Boolean);
    const metrics = [];
    for (let index = 0; index < tokens.length; index += 1) {
      const value = parseCompactCount(tokens[index]);
      if (value === null) {
        continue;
      }
      const prev = normalizeText(tokens[index - 1] || "").toLowerCase();
      const next = normalizeText(tokens[index + 1] || "").toLowerCase();
      metrics.push({
        raw: tokens[index],
        value,
        prev,
        next
      });
    }

    const likeMetric = metrics.find((item) => /(like|likes|heart|hearts|赞|获赞|좋아요|curtida|curtidas|suka)/i.test(`${item.prev} ${item.next}`))
      || metrics[0]
      || null;
    const commentMetric = metrics.find((item, index) => index > 0 && /(comment|comments|reply|replies|评论|回复|coment|komentar|댓글)/i.test(`${item.prev} ${item.next}`))
      || null;
    return {
      likeCount: likeMetric?.value ?? null,
      likeText: likeMetric?.raw || "",
      commentCount: commentMetric?.value ?? null,
      commentText: commentMetric?.raw || "",
      rawText: text.slice(0, 1000)
    };
  }

  function parseCompactCount(value) {
    const source = normalizeText(value).replace(/,/g, "");
    const match = source.match(/^(\d+(?:\.\d+)?)([KMB万千])?$/i);
    if (!match) {
      return null;
    }
    const number = Number(match[1]);
    if (!Number.isFinite(number)) {
      return null;
    }
    const unit = (match[2] || "").toLowerCase();
    const multiplier = unit === "k"
      ? 1_000
      : unit === "m"
        ? 1_000_000
        : unit === "b"
          ? 1_000_000_000
          : unit === "万"
            ? 10_000
            : unit === "千"
              ? 1_000
              : 1;
    return Math.round(number * multiplier);
  }

  function extractPublishedText(card) {
    const text = normalizeText(card?.innerText || card?.textContent || "");
    const patterns = [
      /\b20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}日?\b/,
      /\b20\d{2}[-/.年]\d{1,2}\b/,
      /\b\d{1,2}[-/.月]\d{1,2}日?\b/,
      /\b\d+\s*(?:秒|分钟|小时|天|周|月|年|second|seconds|minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years|ago)\b/i
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return normalizeText(match[0]);
      }
    }
    return "";
  }

  function normalizePublishedAt(value) {
    const text = normalizeText(value);
    if (!text) {
      return "";
    }
    const full = text.match(/\b(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?\b/);
    if (full) {
      return formatDateParts(full[1], full[2], full[3]);
    }
    const yearMonth = text.match(/\b(20\d{2})[-/.年](\d{1,2})\b/);
    if (yearMonth) {
      return formatDateParts(yearMonth[1], yearMonth[2], "01");
    }
    const monthDay = text.match(/\b(\d{1,2})[-/.月](\d{1,2})日?\b/);
    if (monthDay) {
      const now = new Date();
      return formatDateParts(String(now.getFullYear()), monthDay[1], monthDay[2]);
    }
    const relative = text.match(/\b(\d+)\s*(秒|分钟|小时|天|周|月|年|second|seconds|minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years|ago)\b/i);
    if (relative) {
      return formatDateObject(subtractRelativeDate(Number(relative[1]), relative[2]));
    }
    return "";
  }

  function subtractRelativeDate(amount, unit) {
    const date = new Date();
    const key = normalizeText(unit).toLowerCase();
    if (/秒|second/.test(key)) {
      date.setSeconds(date.getSeconds() - amount);
    } else if (/分钟|minute/.test(key)) {
      date.setMinutes(date.getMinutes() - amount);
    } else if (/小时|hour/.test(key)) {
      date.setHours(date.getHours() - amount);
    } else if (/天|day/.test(key)) {
      date.setDate(date.getDate() - amount);
    } else if (/周|week/.test(key)) {
      date.setDate(date.getDate() - amount * 7);
    } else if (/月|month/.test(key)) {
      date.setMonth(date.getMonth() - amount);
    } else if (/年|year/.test(key)) {
      date.setFullYear(date.getFullYear() - amount);
    }
    return date;
  }

  function formatDateParts(year, month, day) {
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function formatDateObject(date) {
    return formatDateParts(date.getFullYear(), date.getMonth() + 1, date.getDate());
  }

  async function forceScrollRound(round, sleep) {
    const distance = Math.max(window.innerHeight * (round < 8 ? 1.25 : 1.05), 760);
    focusPage();
    scrollAllTargets(distance);
    scrollLastVisibleVideoIntoView();
    fireWheel(distance);
    fireKeyboardScroll();
    await sleep(520);
    scrollAllTargets(Math.max(window.innerHeight * 0.35, 320));
  }

  function focusPage() {
    try {
      window.focus();
      document.body?.focus?.({ preventScroll: true });
      document.documentElement?.focus?.({ preventScroll: true });
    } catch {
      // Best-effort focus only.
    }
  }

  function scrollAllTargets(distance) {
    const targets = getScrollableTargets();
    window.scrollBy({ top: distance, behavior: "auto" });
    for (const target of targets) {
      if (target === window) {
        continue;
      }
      target.scrollTop = Math.min(target.scrollTop + distance, target.scrollHeight);
      target.dispatchEvent(new Event("scroll", { bubbles: true }));
    }
  }

  function scrollLastVisibleVideoIntoView() {
    const cards = Array.from(document.querySelectorAll(getPostAnchorSelector()))
      .map((anchor) => getVideoCard(anchor) || anchor)
      .filter(Boolean);
    const target = cards[cards.length - 1];
    if (!target) {
      return;
    }
    try {
      target.scrollIntoView({ block: "end", inline: "nearest", behavior: "auto" });
    } catch {
      target.scrollIntoView(false);
    }
  }

  function fireWheel(distance) {
    const target = document.elementFromPoint(Math.floor(window.innerWidth / 2), Math.floor(window.innerHeight * 0.72))
      || document.body
      || document.documentElement;
    const eventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      deltaY: distance,
      deltaX: 0,
      deltaMode: 0
    };
    target.dispatchEvent(new WheelEvent("wheel", eventInit));
    document.dispatchEvent(new WheelEvent("wheel", eventInit));
    window.dispatchEvent(new WheelEvent("wheel", eventInit));
  }

  function fireKeyboardScroll() {
    const target = document.activeElement || document.body || document.documentElement;
    for (const key of ["PageDown", " "]) {
      const eventInit = { bubbles: true, cancelable: true, key, code: key === " " ? "Space" : key };
      target.dispatchEvent(new KeyboardEvent("keydown", eventInit));
      target.dispatchEvent(new KeyboardEvent("keyup", eventInit));
    }
  }

  async function waitForTikTokToRender(sleep, timeoutMs) {
    const startAnchorCount = document.querySelectorAll(getPostAnchorSelector()).length;
    const startHeight = getScrollSnapshot().height;

    await new Promise((resolve) => {
      let settled = false;
      const timeout = setTimeout(done, timeoutMs);
      const observer = new MutationObserver(() => {
        const nextAnchorCount = document.querySelectorAll(getPostAnchorSelector()).length;
        const nextHeight = getScrollSnapshot().height;
        if (nextAnchorCount > startAnchorCount || nextHeight > startHeight + 100) {
          done();
        }
      });

      function done() {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        observer.disconnect();
        resolve();
      }

      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true
      });
    });
    await waitForVisibleCovers(sleep, Math.min(timeoutMs, 2600));
    await sleep(650);
  }

  async function waitForVisibleCovers(sleep, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const visibleAnchors = getVisibleVideoAnchors();
      if (!visibleAnchors.length) {
        await sleep(180);
        continue;
      }

      const withCovers = visibleAnchors.filter((anchor) => extractCoverUrl(getVideoCard(anchor) || anchor)).length;
      if (withCovers >= Math.min(visibleAnchors.length, 6) || withCovers / visibleAnchors.length >= 0.72) {
        return;
      }
      await sleep(220);
    }
  }

  function getVisibleVideoAnchors() {
    return Array.from(document.querySelectorAll(getPostAnchorSelector())).filter((anchor) => {
      const rect = anchor.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < window.innerHeight && rect.width > 40 && rect.height > 40;
    });
  }

  async function clickRetryIfNeeded(sleep) {
    const nodes = Array.from(document.querySelectorAll("button, [role='button']"));
    const retry = nodes.find((node) => {
      const text = normalizeText(node.innerText || node.textContent || "");
      return text === "重试" || /^retry$/i.test(text);
    });
    if (retry) {
      retry.click();
      await sleep(2200);
    }
  }

  function getScrollableTargets() {
    const candidates = [
      document.scrollingElement,
      document.documentElement,
      document.body,
      ...document.querySelectorAll("main, [role='main'], section, div, ul, ol")
    ].filter(Boolean);

    const scored = candidates
      .map((node) => {
        const scrollable = Math.max(0, Number(node.scrollHeight || 0) - Number(node.clientHeight || 0));
        const style = node === document.body || node === document.documentElement
          ? { overflow: "auto", overflowY: "auto" }
          : getComputedStyle(node);
        const looksScrollable = /(auto|scroll|overlay)/.test(`${style.overflowY} ${style.overflow}`);
        const hasVideo = Boolean(node.querySelector?.(getPostAnchorSelector()));
        const score = scrollable + (looksScrollable ? 2000 : 0) + (hasVideo ? 4000 : 0);
        return { node, scrollable, score };
      })
      .filter((item) => item.scrollable > 80)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((item) => item.node);

    return Array.from(new Set(scored));
  }

  function getScrollSnapshot() {
    const targets = getScrollableTargets();
    const tops = targets.map((target) => Number(target.scrollTop || 0));
    const heights = targets.map((target) => Number(target.scrollHeight || 0));
    const scrolling = document.scrollingElement || document.documentElement;
    return {
      top: Math.max(window.scrollY || 0, ...tops),
      height: Math.max(scrolling.scrollHeight || 0, document.body?.scrollHeight || 0, ...heights),
      targets: targets.length
    };
  }

  function isProbablyAtEnd() {
    const scrolling = document.scrollingElement || document.documentElement;
    const pageRemaining = scrolling.scrollHeight - (window.scrollY + window.innerHeight);
    const containerRemaining = getScrollableTargets()
      .map((target) => target.scrollHeight - target.scrollTop - target.clientHeight)
      .filter((value) => Number.isFinite(value));
    return Math.min(pageRemaining, ...containerRemaining) < Math.max(window.innerHeight * 1.4, 1000);
  }

  function updateCoverDecisionOverlay(seen, targetLimit, minCoverCount) {
    const covered = countCoveredItems(seen);
    updateOverlay(
      "封面还没加载完",
      `已发现 ${seen.size} 条视频，但只有 ${covered}/${minCoverCount} 条有封面。默认不会把无封面候选带回 WebUI。`,
      "waiting",
      [
        { action: "continue", label: "继续等待" },
        { action: "return", label: `带回 ${Math.min(covered, targetLimit)} 条` }
      ]
    );
  }

  function updateOverlay(title, message, state = "running", actions = []) {
    let overlay = document.getElementById(overlayId);
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = overlayId;
      overlay.style.cssText = [
        "position: fixed",
        "right: 18px",
        "top: 84px",
        "z-index: 2147483647",
        "width: 340px",
        "padding: 16px",
        "border-radius: 18px",
        "box-shadow: 0 18px 60px rgba(0,0,0,.22)",
        "background: #fffaf2",
        "color: #1f1c18",
        "font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif",
        "border: 1px solid rgba(45,35,23,.14)",
        "pointer-events: auto"
      ].join(";");
      document.documentElement.appendChild(overlay);
    }
    const color = state === "error" ? "#b6452f" : state === "waiting" ? "#b98122" : state === "done" ? "#0d6f5b" : "#0d6f5b";
    const actionHtml = actions.length
      ? `<div style="display:flex;gap:8px;margin-top:12px;">${actions.map((action) => `<button type="button" data-tt2text-cover-action="${escapeHtml(action.action)}" style="border:0;border-radius:999px;padding:8px 11px;background:${action.action === "continue" ? "#0d6f5b" : "#e8ddd0"};color:${action.action === "continue" ? "white" : "#3b3128"};font-weight:900;cursor:pointer;">${escapeHtml(action.label)}</button>`).join("")}</div>`
      : "";
    overlay.innerHTML = `
      <div style="font-size:11px;font-weight:900;letter-spacing:.14em;color:${color};text-transform:uppercase;">TT2TEXT COLLECTOR</div>
      <div style="margin-top:8px;font-size:18px;font-weight:900;">${escapeHtml(title)}</div>
      <div style="margin-top:8px;font-size:13px;line-height:1.55;color:#6c6257;">${escapeHtml(message)}</div>
      ${actionHtml}
    `;
    overlay.querySelectorAll("[data-tt2text-cover-action]").forEach((button) => {
      button.addEventListener("click", () => {
        window.TT2TextTikTokCollector.coverDecision = button.getAttribute("data-tt2text-cover-action") || "";
        updateOverlay("已收到选择", "正在处理你的选择...", "running");
      });
    });
  }

  function extractAuthor(url) {
    const match = String(url || "").match(/tiktok\.com\/@([^/]+)/i);
    return match ? match[1] : "";
  }

  function getPostAnchorSelector() {
    return "a[href*='/video/'], a[href*='/photo/']";
  }

  function getTikTokMediaType(url) {
    return String(url || "").includes("/photo/") ? "photo" : "video";
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[char]);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
})();
