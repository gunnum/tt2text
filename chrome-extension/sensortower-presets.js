export const SENSOR_TOWER_BATCH_PRESET = [
  {
    id: "downloads",
    label: "下载量",
    path: "/app-analysis/downloads",
    params: {
      breakdown_attribute: "unifiedAppId",
      metricType: "absolute",
      measure: "downloads"
    }
  },
  {
    id: "revenue",
    label: "收入",
    path: "/app-analysis/revenue",
    params: {
      breakdown_attribute: "unifiedAppId",
      metricType: "absolute",
      measure: "revenue"
    }
  },
  {
    id: "active_users_mau",
    label: "MAU",
    path: "/app-analysis/active-users",
    params: {
      breakdown_attribute: "unifiedAppId",
      metricType: "absolute",
      active_user_measure: "MAU",
      measure: "revenue"
    },
    countries: "usage"
  },
  {
    id: "engagement",
    label: "使用时长/打开频次",
    path: "/app-analysis/time-spent",
    params: {
      breakdown_attribute: "unifiedAppId",
      session_count: "sessionCount",
      time_spent: "timeSpent"
    },
    countries: "all"
  },
  {
    id: "retention_d1",
    label: "日留存",
    path: "/app-analysis/retention",
    params: {
      granularity: "daily",
      time_period: "day",
      retention_period: "day",
      retention_measure: "retentionD1",
      retention_chart_type: "curve"
    }
  },
  {
    id: "reviews",
    label: "评论（Android）",
    path: "/store-marketing/reviews",
    recentDays: 90,
    params: {
      os: "android",
      granularity: "auto",
      metric: "ratingCount",
      breakdown_attribute: "starRating",
      chart_plotting_type: "line",
      rating: ["5", "4", "3", "2", "1"],
      sentiment: ["happy", "mixed", "neutral", "unhappy"]
    }
  },
  {
    id: "demographics_age_gender",
    label: "用户属性：年龄性别",
    path: "/usage-intel/demographics",
    base: "demographics",
    waitMs: 12000,
    params: {
      selected_tab: "demographics"
    }
  },
  {
    id: "category_revenue_top_90d",
    label: "同品类排行：90天收入",
    path: "/market-analysis/top-apps",
    base: "categoryRanking",
    waitMs: 10000,
    timeoutMs: 170000,
    params: {
      metric: "revenue",
      os: "unified",
      edit: "1",
      granularity: "weekly",
      measure: "DAU",
      ad_monetization_metric: "adImpressions",
      ad_monetization_measure: "adImpressions",
      comparison_attribute: "absolute",
      comparison_period: "pop",
      category: "0",
      page: "1",
      page_size: "25",
      custom_fields_filter_mode: "include_unified_apps",
      period: "day",
      country: ["all"],
      device: ["iphone", "ipad", "android"]
    }
  }
];

export const DEFAULT_SENSOR_TOWER_COUNTRIES = [
  "US", "AU", "CA", "CN", "FR", "DE", "GB", "IT", "JP", "RU", "KR", "DZ", "AO", "AR", "AT", "AZ", "BH", "BD", "BY", "BE", "BJ", "BO", "BR", "BG", "BF", "KH", "CM", "CL", "CO", "CG", "CR", "CI", "HR", "CY", "CZ", "DK", "DO", "EC", "EG", "SV", "EE", "FI", "GE", "GH", "GR", "GT", "HK", "HU", "IN", "ID", "IQ", "IE", "IL", "JO", "KZ", "KE", "KW", "LA", "LV", "LB", "LY", "LT", "LU", "MO", "MY", "ML", "MT", "MX", "MA", "MZ", "MM", "NL", "NZ", "NI", "NG", "NO", "OM", "PK", "PA", "PY", "PE", "PH", "PL", "PT", "QA", "RO", "SA", "SN", "RS", "SG", "SK", "SI", "ZA", "ES", "LK", "SE", "CH", "TW", "TZ", "TH", "TN", "TR", "UG", "UA", "AE", "UY", "UZ", "VE", "VN", "YE", "ZM", "ZW"
];

export const USAGE_SENSOR_TOWER_COUNTRIES = [
  "US", "AU", "CA", "CN", "FR", "DE", "GB", "IT", "JP", "RU", "KR", "DZ", "AO", "AR", "AT", "AZ", "BY", "BE", "BR", "BG", "CL", "CO", "CR", "HR", "CZ", "DK", "DO", "EC", "EG", "SV", "FI", "GH", "GR", "GT", "HK", "HU", "IN", "ID", "IE", "IL", "KZ", "KE", "KW", "LB", "LT", "LU", "MO", "MY", "MX", "NL", "NZ", "NG", "NO", "OM", "PK", "PA", "PE", "PH", "PL", "PT", "QA", "RO", "SA", "SG", "SK", "SI", "ZA", "ES", "LK", "SE", "CH", "TW", "TH", "TN", "TR", "UA", "AE", "UY", "UZ", "VE", "VN"
];

export const DEFAULT_SENSOR_TOWER_CATEGORIES = [
  "6018", "6000", "6026", "6017", "6016", "6015", "6023", "6014", "6027", "6013", "6012", "6020", "6011", "6010", "6009", "6008", "6007", "6006", "6005", "6024", "6004", "6003", "6002", "6001", "6022"
];

export const DEFAULT_SENSOR_TOWER_DEVICES = ["iphone", "ipad", "android"];

export function buildSensorTowerBatchUrls(sourceUrl, pageContext = {}) {
  const context = parseSensorTowerContext(sourceUrl, pageContext);
  const baseParams = buildBaseParams(context);
  return SENSOR_TOWER_BATCH_PRESET.map((item) => {
    if (item.base === "categoryRanking" && !context.customFieldsFilterId) {
      return {
        id: item.id,
        label: item.label,
        url: "",
        skipped: true,
        error: "当前详情页没有识别到 App IQ 细分类目链接。"
      };
    }
    if (item.id === "reviews" && !context.saa) {
      return {
        id: item.id,
        label: item.label,
        url: "",
        skipped: true,
        error: "当前详情页没有识别到 Android 包名，已跳过评论采集。"
      };
    }
    const url = new URL(item.path, "https://app.sensortower.com");
    applyParams(url.searchParams, item.base === "demographics"
      ? buildDemographicsParams(context)
      : item.base === "categoryRanking"
        ? buildCategoryRankingParams(context)
        : baseParams);
    if (item.countries === "all") {
      applyParams(url.searchParams, { country: ["all"] });
    }
    if (item.countries === "usage") {
      applyParams(url.searchParams, { country: USAGE_SENSOR_TOWER_COUNTRIES });
    }
    if (item.recentDays) {
      applyParams(url.searchParams, buildRecentDateParams(item.recentDays));
    }
    applyParams(url.searchParams, item.params);
    return {
      id: item.id,
      label: item.label,
      url: url.toString(),
      waitMs: item.waitMs,
      timeoutMs: item.timeoutMs
    };
  });
}

function parseSensorTowerContext(sourceUrl, pageContext = {}) {
  const parsed = new URL(sourceUrl);
  const segments = parsed.pathname.split("/").filter(Boolean);
  const appIqLink = pageContext.appIqLink && typeof pageContext.appIqLink === "object" ? pageContext.appIqLink : {};
  const appIqUrl = appIqLink.href ? new URL(appIqLink.href) : null;
  const appStoreIds = pageContext.appStoreIds && typeof pageContext.appStoreIds === "object" ? pageContext.appStoreIds : {};
  return {
    uai: parsed.searchParams.get("uai") || segments.find((segment) => /^[a-f0-9]{24}$/i.test(segment)) || "",
    sia: parsed.searchParams.get("sia") || parsed.searchParams.get("ssia") || appStoreIds.iosAppId || segments.find((segment) => /^\d{8,12}$/.test(segment)) || "",
    saa: parsed.searchParams.get("saa") || parsed.searchParams.get("ssaa") || appStoreIds.androidPackageId || "",
    customFieldsFilterId: parsed.searchParams.get("custom_fields_filter_id") || appIqLink.customFieldsFilterId || appIqUrl?.searchParams.get("custom_fields_filter_id") || "",
    os: "unified",
    startDate: parsed.searchParams.get("start_date") || getDateMonthsAgo(12),
    endDate: parsed.searchParams.get("end_date") || getYesterdayDate(),
    countries: DEFAULT_SENSOR_TOWER_COUNTRIES,
    categories: DEFAULT_SENSOR_TOWER_CATEGORIES,
    devices: DEFAULT_SENSOR_TOWER_DEVICES
  };
}

function buildCategoryRankingParams(context) {
  return {
    metric: "revenue",
    os: "unified",
    custom_fields_filter_id: context.customFieldsFilterId,
    uai: context.uai,
    saa: context.saa,
    sia: context.sia,
    edit: "1",
    granularity: "weekly",
    start_date: getDateDaysAgo(91),
    end_date: getDateDaysAgo(2),
    duration: "P90D",
    measure: "DAU",
    ad_monetization_metric: "adImpressions",
    ad_monetization_measure: "adImpressions",
    comparison_attribute: "absolute",
    comparison_period: "pop",
    category: "0",
    page: "1",
    page_size: "25",
    custom_fields_filter_mode: "include_unified_apps",
    period: "day",
    country: ["all"],
    device: DEFAULT_SENSOR_TOWER_DEVICES
  };
}

function buildBaseParams(context) {
  return {
    os: context.os,
    edit: "1",
    granularity: "monthly",
    start_date: context.startDate,
    end_date: context.endDate,
    breakdown_attribute: "unifiedAppId",
    chart_plotting_type: "line",
    ssia: context.sia,
    sia: context.sia,
    ssaa: context.saa,
    saa: context.saa,
    metricType: "absolute",
    time_period: "month",
    rolling_days: "0",
    selected_tab: "0",
    measure: "revenue",
    install_base_measure: "installBase",
    active_user_measure: "DAU",
    session_count: "sessionCount",
    time_spent: "timeSpent",
    retention_period: "day",
    retention_measure: "retentionD1",
    retention_chart_type: "curve",
    ad_monetization_measure: "adImpressions",
    ad_monetization_metric: "adImpressions",
    impression_share_metric_option: "all",
    platform_type: "networks",
    duration: "P12M",
    uai: context.uai,
    country: context.countries,
    category: context.categories,
    device: context.devices
  };
}

function buildDemographicsParams(context) {
  return {
    os: "ios",
    start_date: "2021-01-01",
    end_date: getDateDaysAgo(5),
    selected_tab: "demographics",
    saa: context.saa,
    sia: context.sia,
    country: "all",
    locale: "zh-CN",
    period: "day"
  };
}

function buildRecentDateParams(days) {
  return {
    start_date: getDateDaysAgo(days),
    end_date: getTodayDate(),
    duration: `P${days}D`,
    page: "1",
    page_size: "500"
  };
}

function applyParams(searchParams, params) {
  for (const [key, value] of Object.entries(params)) {
    searchParams.delete(key);
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (item !== undefined && item !== null && String(item) !== "") {
        searchParams.append(key, item);
      }
    }
  }
}

function getTodayDate() {
  return formatDate(new Date());
}

function getYesterdayDate() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return formatDate(date);
}

function getDateMonthsAgo(months) {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  date.setDate(date.getDate() - 1);
  return formatDate(date);
}

function getDateDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return formatDate(date);
}

function formatDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}
