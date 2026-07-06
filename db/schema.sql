PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS apps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  full_name TEXT,
  bundle_id TEXT,
  seller_name TEXT,
  logo_url TEXT,
  app_store_url TEXT,
  created_at TEXT,
  raw_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_metric_snapshots (
  id TEXT PRIMARY KEY,
  app_id TEXT,
  source TEXT,
  source_url TEXT,
  page_title TEXT,
  app_name TEXT,
  matched INTEGER NOT NULL DEFAULT 0,
  match_source TEXT,
  metrics_json TEXT,
  tables_json TEXT,
  filters_json TEXT,
  overview_json TEXT,
  folder_path TEXT,
  html_path TEXT,
  page_text TEXT,
  collected_at TEXT,
  raw_json TEXT NOT NULL,
  FOREIGN KEY (app_id) REFERENCES apps(id)
);

CREATE TABLE IF NOT EXISTS sensor_csv_imports (
  id TEXT PRIMARY KEY,
  app_id TEXT,
  source TEXT,
  source_url TEXT,
  page_title TEXT,
  data_type TEXT,
  chart_id TEXT,
  chart_label TEXT,
  metric TEXT,
  app_name TEXT,
  app_developer TEXT,
  matched INTEGER NOT NULL DEFAULT 0,
  match_source TEXT,
  csv_path TEXT,
  parsed_path TEXT,
  folder_path TEXT,
  archived_filename TEXT,
  original_filename TEXT,
  original_source TEXT,
  download_url TEXT,
  total_bytes INTEGER,
  row_count INTEGER,
  headers_json TEXT,
  filters_json TEXT,
  date_start TEXT,
  date_end TEXT,
  date_duration TEXT,
  imported_at TEXT,
  raw_json TEXT NOT NULL,
  FOREIGN KEY (app_id) REFERENCES apps(id)
);

CREATE TABLE IF NOT EXISTS sensor_rows (
  id TEXT PRIMARY KEY,
  import_id TEXT NOT NULL,
  row_index INTEGER NOT NULL,
  app_id TEXT,
  platform_app_id TEXT,
  app_name TEXT,
  unified_id TEXT,
  unified_name TEXT,
  publisher_id TEXT,
  publisher_name TEXT,
  date TEXT,
  country_region TEXT,
  platform TEXT,
  device TEXT,
  downloads REAL,
  revenue_usd REAL,
  rpd_usd REAL,
  mau REAL,
  avg_time_spent_minutes_month REAL,
  total_time_spent_years REAL,
  avg_minutes_session REAL,
  avg_session_count_month REAL,
  total_session_count REAL,
  title TEXT,
  content TEXT,
  username TEXT,
  tags TEXT,
  rating REAL,
  sentiment TEXT,
  version TEXT,
  feedback_source TEXT,
  feedback_platform TEXT,
  feedback_type TEXT,
  os TEXT,
  raw_json TEXT NOT NULL,
  FOREIGN KEY (import_id) REFERENCES sensor_csv_imports(id) ON DELETE CASCADE,
  FOREIGN KEY (app_id) REFERENCES apps(id)
);

CREATE INDEX IF NOT EXISTS idx_sensor_rows_import ON sensor_rows(import_id);
CREATE INDEX IF NOT EXISTS idx_sensor_rows_app_date ON sensor_rows(app_id, date);
CREATE INDEX IF NOT EXISTS idx_sensor_rows_feedback ON sensor_rows(feedback_platform, feedback_type, sentiment, rating);
CREATE INDEX IF NOT EXISTS idx_sensor_rows_app_country ON sensor_rows(app_id, country_region);

CREATE TABLE IF NOT EXISTS category_ranking_rows (
  id TEXT PRIMARY KEY,
  import_id TEXT NOT NULL,
  subject_app_id TEXT,
  row_index INTEGER NOT NULL,
  rank INTEGER,
  platform_app_id TEXT,
  unified_id TEXT,
  app_name TEXT,
  unified_name TEXT,
  publisher_name TEXT,
  revenue_usd_90d REAL,
  monthly_revenue_usd REAL,
  downloads_90d REAL,
  dau REAL,
  country_codes TEXT,
  os TEXT,
  devices TEXT,
  category_name TEXT,
  metric TEXT,
  comparison_attribute TEXT,
  date_start TEXT,
  date_end TEXT,
  date_duration TEXT,
  imported_at TEXT,
  raw_json TEXT NOT NULL,
  FOREIGN KEY (import_id) REFERENCES sensor_csv_imports(id) ON DELETE CASCADE,
  FOREIGN KEY (subject_app_id) REFERENCES apps(id)
);

CREATE INDEX IF NOT EXISTS idx_category_ranking_import ON category_ranking_rows(import_id);
CREATE INDEX IF NOT EXISTS idx_category_ranking_subject_revenue ON category_ranking_rows(subject_app_id, monthly_revenue_usd DESC);
CREATE INDEX IF NOT EXISTS idx_category_ranking_subject_downloads ON category_ranking_rows(subject_app_id, downloads_90d DESC);
CREATE INDEX IF NOT EXISTS idx_category_ranking_subject_dau ON category_ranking_rows(subject_app_id, dau DESC);

CREATE TABLE IF NOT EXISTS category_ranking_snapshots (
  snapshot_key TEXT PRIMARY KEY,
  import_id TEXT NOT NULL,
  custom_fields_filter_id TEXT,
  category_name TEXT,
  metric TEXT,
  comparison_attribute TEXT,
  date_start TEXT,
  date_end TEXT,
  date_duration TEXT,
  country_codes TEXT,
  os TEXT,
  devices TEXT,
  source_url TEXT,
  row_count INTEGER,
  imported_at TEXT,
  updated_at TEXT,
  summary_json TEXT,
  raw_json TEXT NOT NULL,
  FOREIGN KEY (import_id) REFERENCES sensor_csv_imports(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS category_ranking_snapshot_rows (
  id TEXT PRIMARY KEY,
  snapshot_key TEXT NOT NULL,
  import_id TEXT NOT NULL,
  row_index INTEGER NOT NULL,
  rank INTEGER,
  platform_app_id TEXT,
  unified_id TEXT,
  app_name TEXT,
  unified_name TEXT,
  publisher_name TEXT,
  revenue_usd_90d REAL,
  monthly_revenue_usd REAL,
  downloads_90d REAL,
  dau REAL,
  raw_json TEXT NOT NULL,
  FOREIGN KEY (snapshot_key) REFERENCES category_ranking_snapshots(snapshot_key) ON DELETE CASCADE,
  FOREIGN KEY (import_id) REFERENCES sensor_csv_imports(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app_category_ranking_links (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  snapshot_key TEXT NOT NULL,
  custom_fields_filter_id TEXT,
  source TEXT,
  linked_at TEXT,
  latest_import_id TEXT,
  raw_json TEXT NOT NULL,
  FOREIGN KEY (app_id) REFERENCES apps(id),
  FOREIGN KEY (snapshot_key) REFERENCES category_ranking_snapshots(snapshot_key) ON DELETE CASCADE,
  FOREIGN KEY (latest_import_id) REFERENCES sensor_csv_imports(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_category_ranking_snapshots_filter ON category_ranking_snapshots(custom_fields_filter_id, metric, date_start, date_end);
CREATE INDEX IF NOT EXISTS idx_category_ranking_snapshot_rows_revenue ON category_ranking_snapshot_rows(snapshot_key, monthly_revenue_usd DESC);
CREATE INDEX IF NOT EXISTS idx_app_category_ranking_links_app ON app_category_ranking_links(app_id, linked_at DESC);

CREATE VIEW IF NOT EXISTS app_country_market_summary AS
WITH country_metrics AS (
  SELECT
    r.app_id,
    r.country_region,
    SUM(CASE WHEN i.data_type = 'downloads' AND r.downloads IS NOT NULL THEN r.downloads ELSE 0 END) AS downloads,
    SUM(CASE WHEN i.data_type = 'revenue' AND r.revenue_usd IS NOT NULL THEN r.revenue_usd ELSE 0 END) AS revenue_usd,
    MIN(CASE WHEN i.data_type = 'downloads' AND r.downloads IS NOT NULL THEN r.date ELSE NULL END) AS downloads_date_start,
    MAX(CASE WHEN i.data_type = 'downloads' AND r.downloads IS NOT NULL THEN r.date ELSE NULL END) AS downloads_date_end,
    MIN(CASE WHEN i.data_type = 'revenue' AND r.revenue_usd IS NOT NULL THEN r.date ELSE NULL END) AS revenue_date_start,
    MAX(CASE WHEN i.data_type = 'revenue' AND r.revenue_usd IS NOT NULL THEN r.date ELSE NULL END) AS revenue_date_end
  FROM sensor_rows r
  JOIN sensor_csv_imports i ON i.id = r.import_id
  WHERE r.app_id IS NOT NULL
    AND r.country_region IS NOT NULL
    AND r.country_region <> ''
    AND r.country_region <> 'all'
    AND i.data_type IN ('downloads', 'revenue')
  GROUP BY r.app_id, r.country_region
),
country_totals AS (
  SELECT
    app_id,
    country_region,
    downloads,
    revenue_usd,
    SUM(downloads) OVER (PARTITION BY app_id) AS total_downloads,
    SUM(revenue_usd) OVER (PARTITION BY app_id) AS total_revenue_usd,
    downloads_date_start,
    downloads_date_end,
    revenue_date_start,
    revenue_date_end
  FROM country_metrics
  WHERE downloads > 0 OR revenue_usd > 0
)
SELECT
  app_id,
  country_region,
  downloads,
  revenue_usd,
  CASE WHEN downloads > 0 THEN revenue_usd / downloads ELSE NULL END AS revenue_per_download_usd,
  CASE WHEN total_downloads > 0 THEN downloads / total_downloads ELSE NULL END AS download_share,
  CASE WHEN total_revenue_usd > 0 THEN revenue_usd / total_revenue_usd ELSE NULL END AS revenue_share,
  CASE
    WHEN total_revenue_usd > 0 AND total_downloads > 0
      THEN (revenue_usd / total_revenue_usd) - (downloads / total_downloads)
    ELSE NULL
  END AS revenue_download_share_gap,
  CASE
    WHEN total_revenue_usd > 0 AND total_downloads > 0 AND downloads > 0
      THEN (revenue_usd / total_revenue_usd) / (downloads / total_downloads)
    ELSE NULL
  END AS revenue_to_download_share_ratio,
  RANK() OVER (PARTITION BY app_id ORDER BY downloads DESC) AS download_rank,
  RANK() OVER (PARTITION BY app_id ORDER BY revenue_usd DESC) AS revenue_rank,
  downloads_date_start,
  downloads_date_end,
  revenue_date_start,
  revenue_date_end
FROM country_totals;

CREATE VIEW IF NOT EXISTS app_country_review_summary AS
SELECT
  app_id,
  country_region,
  feedback_platform,
  os,
  COUNT(*) AS review_count,
  AVG(rating) AS avg_rating,
  SUM(CASE WHEN rating <= 2 THEN 1 ELSE 0 END) AS low_rating_count,
  SUM(CASE WHEN rating >= 4 THEN 1 ELSE 0 END) AS high_rating_count,
  SUM(CASE WHEN LOWER(sentiment) = 'unhappy' THEN 1 ELSE 0 END) AS unhappy_count,
  SUM(CASE WHEN LOWER(sentiment) = 'happy' THEN 1 ELSE 0 END) AS happy_count,
  MIN(date) AS first_review_date,
  MAX(date) AS last_review_date
FROM sensor_rows
WHERE feedback_type = 'review'
  AND app_id IS NOT NULL
  AND country_region IS NOT NULL
  AND country_region <> ''
GROUP BY app_id, country_region, feedback_platform, os;

CREATE VIEW IF NOT EXISTS app_country_market_review_comparison AS
WITH countries AS (
  SELECT app_id, country_region FROM app_country_market_summary
  UNION
  SELECT app_id, country_region FROM app_country_review_summary
),
review_totals AS (
  SELECT
    app_id,
    country_region,
    SUM(review_count) AS review_count,
    CASE WHEN SUM(review_count) > 0 THEN SUM(avg_rating * review_count) / SUM(review_count) ELSE NULL END AS avg_rating,
    SUM(low_rating_count) AS low_rating_count,
    SUM(high_rating_count) AS high_rating_count,
    SUM(unhappy_count) AS unhappy_count,
    SUM(happy_count) AS happy_count,
    MIN(first_review_date) AS first_review_date,
    MAX(last_review_date) AS last_review_date
  FROM app_country_review_summary
  GROUP BY app_id, country_region
)
SELECT
  c.app_id,
  c.country_region,
  m.downloads,
  m.revenue_usd,
  m.revenue_per_download_usd,
  m.download_share,
  m.revenue_share,
  m.revenue_download_share_gap,
  m.revenue_to_download_share_ratio,
  m.download_rank,
  m.revenue_rank,
  CASE WHEN m.download_rank <= 10 THEN 1 ELSE 0 END AS is_top_download_country,
  CASE WHEN m.revenue_rank <= 10 THEN 1 ELSE 0 END AS is_top_revenue_country,
  CASE
    WHEN m.download_rank <= 10 AND m.revenue_rank <= 10 THEN 'top_download_and_revenue'
    WHEN m.download_rank <= 10 THEN 'top_download_only'
    WHEN m.revenue_rank <= 10 THEN 'top_revenue_only'
    WHEN m.country_region IS NOT NULL THEN 'other_market_country'
    ELSE 'review_only_country'
  END AS market_segment,
  rt.review_count,
  rt.avg_rating,
  rt.low_rating_count,
  rt.high_rating_count,
  rt.unhappy_count,
  rt.happy_count,
  CASE WHEN rt.review_count > 0 THEN CAST(rt.low_rating_count AS REAL) / rt.review_count ELSE NULL END AS low_rating_share,
  CASE WHEN rt.review_count > 0 THEN CAST(rt.unhappy_count AS REAL) / rt.review_count ELSE NULL END AS unhappy_share,
  rt.first_review_date,
  rt.last_review_date
FROM countries c
LEFT JOIN app_country_market_summary m
  ON m.app_id = c.app_id AND m.country_region = c.country_region
LEFT JOIN review_totals rt
  ON rt.app_id = c.app_id AND rt.country_region = c.country_region;

CREATE TABLE IF NOT EXISTS tiktok_results (
  id TEXT PRIMARY KEY,
  app_id TEXT,
  source_url TEXT,
  normalized_url TEXT,
  hyperlink TEXT,
  title TEXT,
  hashtags_json TEXT,
  media_type TEXT,
  author TEXT,
  published_at TEXT,
  published_text TEXT,
  transcript_origin TEXT,
  transcript_en TEXT,
  transcript_zh TEXT,
  visual_summary TEXT,
  source_language TEXT,
  source_language_probability REAL,
  like_count INTEGER,
  comment_count INTEGER,
  share_count INTEGER,
  view_count INTEGER,
  relevance_status TEXT,
  relevance_is_relevant INTEGER,
  relevance_confidence REAL,
  relevance_reason TEXT,
  first_frame_path TEXT,
  visual_frame_paths_json TEXT,
  comments_item_count INTEGER,
  created_at TEXT,
  updated_at TEXT,
  raw_json TEXT NOT NULL,
  FOREIGN KEY (app_id) REFERENCES apps(id)
);

CREATE INDEX IF NOT EXISTS idx_tiktok_results_app ON tiktok_results(app_id);
CREATE INDEX IF NOT EXISTS idx_tiktok_results_relevance ON tiktok_results(relevance_is_relevant, relevance_confidence);

CREATE TABLE IF NOT EXISTS tiktok_comments (
  id TEXT PRIMARY KEY,
  result_id TEXT,
  app_id TEXT,
  source_url TEXT,
  normalized_url TEXT,
  video_title TEXT,
  author TEXT,
  text TEXT NOT NULL,
  raw_text TEXT,
  like_count INTEGER,
  like_text TEXT,
  time_text TEXT,
  reply_count INTEGER,
  reply_count_text TEXT,
  language TEXT,
  captured_at TEXT,
  imported_at TEXT,
  updated_at TEXT,
  raw_json TEXT NOT NULL,
  FOREIGN KEY (result_id) REFERENCES tiktok_results(id),
  FOREIGN KEY (app_id) REFERENCES apps(id)
);

CREATE INDEX IF NOT EXISTS idx_tiktok_comments_result ON tiktok_comments(result_id);
CREATE INDEX IF NOT EXISTS idx_tiktok_comments_app ON tiktok_comments(app_id);

CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  app_id TEXT,
  source_url TEXT,
  title TEXT,
  subtitle TEXT,
  source_name TEXT,
  source_domain TEXT,
  author TEXT,
  published_at TEXT,
  created_at TEXT,
  bundle_path TEXT,
  manifest_path TEXT,
  clean_markdown_path TEXT,
  brief_markdown_path TEXT,
  cover_image_path TEXT,
  image_count INTEGER,
  content_block_count INTEGER,
  excerpt TEXT,
  core_insights_json TEXT,
  owned_bundle INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT NOT NULL,
  FOREIGN KEY (app_id) REFERENCES apps(id)
);

CREATE INDEX IF NOT EXISTS idx_articles_app ON articles(app_id);

CREATE TABLE IF NOT EXISTS video_jobs (
  id TEXT PRIMARY KEY,
  app_id TEXT,
  result_id TEXT,
  status TEXT,
  progress REAL,
  stage TEXT,
  stage_key TEXT,
  source_url TEXT,
  normalized_url TEXT,
  title TEXT,
  preview_text TEXT,
  author TEXT,
  cover_url TEXT,
  duration TEXT,
  error TEXT,
  retry_count INTEGER,
  job_dir TEXT,
  first_frame_path TEXT,
  created_at TEXT,
  updated_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  raw_json TEXT NOT NULL,
  FOREIGN KEY (app_id) REFERENCES apps(id),
  FOREIGN KEY (result_id) REFERENCES tiktok_results(id)
);

CREATE INDEX IF NOT EXISTS idx_video_jobs_status ON video_jobs(status);

CREATE TABLE IF NOT EXISTS report_runs (
  id TEXT PRIMARY KEY,
  app_id TEXT,
  title TEXT,
  prompt TEXT,
  source_selection_json TEXT,
  report_md_path TEXT,
  report_html_path TEXT,
  created_at TEXT,
  raw_json TEXT,
  FOREIGN KEY (app_id) REFERENCES apps(id)
);
