export function createAdShotAppMatchService(deps = {}) {
  const requiredDeps = [
    "readApps",
    "matchAppByName",
    "addAppFromStoreSearch",
    "pickResultAppFields",
    "normalizeAppDisplayName",
    "normalizeText",
    "uniqueStrings"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createAdShotAppMatchService 缺少依赖：${dep}`);
    }
  }

  async function resolveAdShotAppMatch({ brandName, appName, title, landingPage } = {}) {
    let apps = await deps.readApps();
    const groups = buildAdShotAppCandidateGroups({ brandName, appName, title, landingPage, apps });
    const allCandidates = groups.flatMap((group) => group.candidates.map((candidate) => candidate.query));
    if (!allCandidates.length) {
      return {
        appId: "",
        app: null,
        status: "unmatched",
        source: "none",
        query: "",
        error: "",
        evidence: []
      };
    }

    for (const group of groups) {
      for (const candidate of group.candidates) {
        const matched = matchCandidateAgainstApps(apps, candidate.query);
        if (matched) {
          return buildMatchedResult(matched, candidate, "local-name");
        }
      }
    }

    for (const group of groups) {
      for (const candidate of group.candidates) {
        if (!candidate.allowSearch) {
          continue;
        }
        try {
          const created = await deps.addAppFromStoreSearch(candidate.query);
          if (!created) {
            continue;
          }
          apps = await deps.readApps();
          const matched = apps.find((app) => app.id === created.id) || created;
          return buildMatchedResult(matched, candidate, "appstore-search");
        } catch (error) {
          return {
            appId: "",
            app: null,
            status: "unmatched",
            source: "appstore-search",
            query: candidate.query,
            error: error instanceof Error ? error.message : String(error),
            evidence: groups.map((groupItem) => ({
              source: groupItem.source,
              query: groupItem.candidates.map((item) => item.query).join(" | ")
            }))
          };
        }
      }
    }

    return {
      appId: "",
      app: null,
      status: "unmatched",
      source: groups[0]?.source || "none",
      query: groups[0]?.candidates[0]?.query || "",
      error: "",
      evidence: groups.map((group) => ({
        source: group.source,
        query: group.candidates.map((item) => item.query).join(" | ")
      }))
    };
  }

  function buildMatchedResult(app, candidate, source) {
    return {
      appId: app.id,
      app: deps.pickResultAppFields(app),
      status: "matched",
      source,
      query: candidate.query,
      error: "",
      evidence: [{ source: candidate.source, query: candidate.query }]
    };
  }

  function buildAdShotAppCandidateGroups({ brandName, appName, title, landingPage, apps = [] } = {}) {
    const groups = [];
    const brandCandidates = buildBrandCandidates(brandName, appName);
    if (brandCandidates.length) {
      groups.push({
        source: "brand-name",
        candidates: brandCandidates.map((query) => ({ query, source: "brand-name", allowSearch: true }))
      });
    }

    const landingCandidates = buildLandingPageCandidates(landingPage);
    if (landingCandidates.length) {
      groups.push({
        source: "landing-page",
        candidates: landingCandidates.map((query) => ({ query, source: "landing-page", allowSearch: true }))
      });
    }

    const titleCandidates = buildTitleCandidates(title, apps);
    if (titleCandidates.length) {
      groups.push({
        source: "title",
        candidates: titleCandidates.map((query) => ({ query, source: "title", allowSearch: false }))
      });
    }

    return groups;
  }

  function buildBrandCandidates(brandName, appName) {
    return deps.uniqueStrings([
      stripAdShotBrandSlogan(brandName),
      stripAdShotBrandSlogan(appName),
      normalizeAdShotAppSearchQuery(brandName),
      normalizeAdShotAppSearchQuery(appName)
    ].map(normalizeAdShotAppSearchQuery))
      .filter(isUsefulCandidate)
      .slice(0, 3);
  }

  function buildLandingPageCandidates(landingPage) {
    const urlCandidates = extractLandingPageBrandCandidates(landingPage);
    return deps.uniqueStrings(urlCandidates.map(normalizeAdShotAppSearchQuery))
      .filter(isUsefulCandidate)
      .slice(0, 2);
  }

  function buildTitleCandidates(title, apps = []) {
    const text = deps.normalizeText(title);
    if (!text) {
      return [];
    }
    const localAppCandidates = extractKnownAppNamesFromTitle(text, apps);
    if (localAppCandidates.length) {
      return localAppCandidates.slice(0, 3);
    }

    const cleaned = text
      .replace(/#[^\s#]+/g, " ")
      .replace(/@[^\s@]+/g, " ")
      .replace(/\b(get more matches on|download|install|try|meet|find|join|discover)\b/gi, " ")
      .replace(/\b(pov)\b[:：]?\s*/gi, " ")
      .replace(/[^\p{L}\p{N}\s]+/gu, " ")
      .replace(/\s{2,}/g, " ")
      .trim();

    const rawTokens = cleaned.split(/\s+/).filter(Boolean);
    const preferred = [];
    for (const token of rawTokens) {
      const normalizedToken = normalizeAdShotAppSearchQuery(token);
      if (!looksLikeBrandToken(normalizedToken)) {
        continue;
      }
      preferred.push(normalizedToken);
      if (preferred.length >= 3) {
        break;
      }
    }

    return deps.uniqueStrings(preferred)
      .filter(isUsefulCandidate)
      .slice(0, 3);
  }

  function extractKnownAppNamesFromTitle(title, apps = []) {
    const normalizedTitle = normalizeLooseName(title);
    if (!normalizedTitle) {
      return [];
    }
    const candidates = [];
    for (const app of Array.isArray(apps) ? apps : []) {
      for (const rawCandidate of [
        app?.name,
        app?.fullName,
        stripAdShotBrandSlogan(app?.name),
        stripAdShotBrandSlogan(app?.fullName)
      ]) {
        const candidate = normalizeAdShotAppSearchQuery(rawCandidate);
        const normalizedCandidate = normalizeLooseName(candidate);
        if (!isUsefulCandidate(candidate) || !looksLikeBrandToken(candidate) || normalizedCandidate.length < 3) {
          continue;
        }
        if (!normalizedTitle.includes(normalizedCandidate)) {
          continue;
        }
        candidates.push(candidate);
      }
    }
    return deps.uniqueStrings(candidates)
      .sort((a, b) => normalizeLooseName(b).length - normalizeLooseName(a).length)
      .slice(0, 3);
  }

  function stripAdShotBrandSlogan(value) {
    const text = deps.normalizeText(value);
    if (!text) {
      return "";
    }
    return text
      .split(/\s*[|｜]\s*|\s+[–—-]\s+|\s*,\s+/)[0]
      .split(/\.\s+/)[0]
      .trim();
  }

  function normalizeAdShotAppSearchQuery(value) {
    const text = deps.normalizeText(value)
      .replace(/\b(your friends for real|self-growth challenge)\b/gi, "")
      .replace(/\b(app|official|tiktok|top ads?)\b/gi, "")
      .replace(/[.\-:：,，|｜]+$/g, "")
      .replace(/\s+[.\-:：,，|｜]+/g, " ")
      .replace(/[.\-:：,，|｜]+\s*$/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    return deps.normalizeAppDisplayName(text);
  }

  function isUsefulCandidate(value) {
    return value.length >= 2
      && !/^(unknown|未指定|未识别 app|social|dating|app|others?)$/i.test(value)
      && !/(欧美|社交|交友|social app|dating app|friends? app)/i.test(value);
  }

  function extractLandingPageBrandCandidates(landingPage) {
    const text = deps.normalizeText(landingPage);
    if (!text) {
      return [];
    }
    try {
      const parsed = new URL(text);
      const hostParts = parsed.hostname.split(".").filter(Boolean);
      const stem = hostParts.find((part) => !/^(www|m|get|go|app|link|links)$/i.test(part)) || "";
      const cleanedStem = stem.replace(/app$/i, "");
      return deps.uniqueStrings([
        stripLandingPageHostPrefix(cleanedStem),
        cleanedStem
      ].filter(Boolean));
    } catch {
      return [];
    }
  }

  function stripLandingPageHostPrefix(value) {
    return deps.normalizeText(value)
      .replace(/^(match|meet|join|try|get|go|download|install)(?=[a-z0-9]{3,}$)/i, "")
      .trim();
  }

  function looksLikeBrandToken(token) {
    const text = String(token || "").trim();
    if (text.length < 2) {
      return false;
    }
    if (/^(pov|app|dating|social|singlelife|love|matches|friends|music|spotify|amici|scuola|it|its|it’s|will|be|when|time|on|at|monday|but|you|are|the|bros|with|from|our|creators|dump)$/i.test(text)) {
      return false;
    }
    return /[a-z]/i.test(text);
  }

  function matchCandidateAgainstApps(apps, candidate) {
    const exact = deps.matchAppByName(apps, candidate);
    if (!exact) {
      return null;
    }

    const normalizedCandidate = normalizeLooseName(candidate);
    const normalizedAppName = normalizeLooseName(exact.name);
    const normalizedFullName = normalizeLooseName(exact.fullName || "");
    if (
      normalizedCandidate === normalizedAppName
      || normalizedCandidate === normalizedFullName
      || normalizedCandidate === normalizedAppName.replace(/app$/i, "")
      || normalizedAppName === normalizedCandidate.replace(/app$/i, "")
    ) {
      return exact;
    }

    return null;
  }

  function normalizeLooseName(value) {
    return deps.normalizeText(value).replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "").toLowerCase();
  }

  return {
    resolveAdShotAppMatch
  };
}
