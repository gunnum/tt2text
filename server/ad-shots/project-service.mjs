import {
  isReadingProject,
  normalizeAdShotProjectTags
} from "./normalizers.mjs";

export function createAdShotProjectService(deps = {}) {
  const requiredDeps = [
    "readProjectsRaw",
    "writeProjectsRaw",
    "readShots",
    "writeShots",
    "readSubscriptionLogsRaw",
    "normalizeAdShotRecord",
    "normalizeStringArray",
    "normalizeText",
    "truncateText",
    "slugifyId",
    "createJobId",
    "formatDate"
  ];
  for (const dep of requiredDeps) {
    if (!deps[dep]) {
      throw new Error(`createAdShotProjectService 缺少依赖：${dep}`);
    }
  }

  async function readAdShotProjects() {
    const projects = await deps.readProjectsRaw();
    return normalizeAdShotProjects(projects);
  }

  async function writeAdShotProjects(projects) {
    await deps.writeProjectsRaw(normalizeAdShotProjects(projects));
  }

  async function readAdShotProjectsWithStats() {
    const [projects, shots, logs] = await Promise.all([
      readAdShotProjects(),
      deps.readShots(),
      deps.readSubscriptionLogsRaw()
    ]);
    const statsByProject = new Map(projects.map((project) => [project.id, {
      shotCount: 0,
      status: "正常",
      statusDetail: "",
      lastRunAt: "",
      lastError: ""
    }]));

    for (const shot of shots) {
      for (const projectId of deps.normalizeStringArray(shot.projectIds)) {
        if (!statsByProject.has(projectId)) {
          continue;
        }
        statsByProject.get(projectId).shotCount += 1;
      }
    }

    for (const log of Array.isArray(logs) ? logs : []) {
      const projectId = normalizeText(log?.projectId || log?.project_id);
      if (!statsByProject.has(projectId)) {
        continue;
      }
      const stats = statsByProject.get(projectId);
      const startedAt = normalizeText(log.startedAt || log.started_at || log.createdAt || log.created_at);
      if (!stats.lastRunAt || startedAt.localeCompare(stats.lastRunAt) > 0) {
        stats.lastRunAt = startedAt;
        stats.lastError = normalizeText(log.status) === "failed"
          ? normalizeText(log.error || log.failureReason || log.failure_reason)
          : "";
      }
    }

    return projects.map((project) => {
      const stats = statsByProject.get(project.id) || {};
      const needsAttention = shots.filter((shot) =>
        deps.normalizeStringArray(shot.projectIds).includes(project.id)
        && ["failed", "失败", "needs_detail", "needs_capture", "需补采"].includes(normalizeText(shot.status || shot.analysisStatus))
      ).length;
      return {
        ...project,
        shotCount: stats.shotCount || 0,
        displayStatus: needsAttention ? `有 ${needsAttention} 条待处理` : "正常",
        lastRunAt: stats.lastRunAt || "",
        lastError: stats.lastError || ""
      };
    });
  }

  async function saveAdShotProjects(payload) {
    if (!payload || typeof payload !== "object") {
      throw new Error("缺少项目数据。");
    }

    const now = deps.formatDate(new Date());
    const existingProjects = await readAdShotProjects();
    const existingById = new Map(existingProjects.map((project) => [project.id, project]));
    const rawProjects = Array.isArray(payload.projects) ? payload.projects : [];
    if (!rawProjects.length) {
      throw new Error("项目列表不能为空。");
    }

    const normalized = normalizeAdShotProjects(rawProjects.map((project, index) => {
      const id = normalizeText(project.id || project.projectId) || `proj_${deps.slugifyId(project.name) || deps.createJobId()}`;
      const existing = existingById.get(id);
      return {
        ...existing,
        ...project,
        id,
        order: Number(project.order) || index + 1,
        createdAt: normalizeText(existing?.createdAt || project.createdAt) || now,
        updatedAt: now
      };
    }));
    await writeAdShotProjects(normalized);
    return await readAdShotProjectsWithStats();
  }

  async function assignAdShotProjects(payload) {
    const shotId = normalizeText(payload?.shotId || payload?.shot_id || payload?.id);
    if (!shotId) {
      throw new Error("缺少 Shot ID。");
    }

    const projects = await readAdShotProjects();
    const validProjectIds = new Set(projects.map((project) => project.id));
    const projectIds = deps.normalizeStringArray(payload.projectIds || payload.project_ids || payload.projectId || payload.project_id)
      .filter((projectId) => validProjectIds.has(projectId));
    if (!projectIds.length) {
      throw new Error("请至少选择一个有效项目。");
    }

    const shots = await deps.readShots();
    const index = shots.findIndex((shot) => shot.shotId === shotId);
    if (index < 0) {
      throw new Error("没有找到这个 Ad Shot。");
    }

    const updatedAt = deps.formatDate(new Date());
    shots[index] = deps.normalizeAdShotRecord({
      ...shots[index],
      projectIds,
      targetApp: shots[index].targetApp,
      updatedAt
    }, projects);
    await deps.writeShots(shots);
    return shots[index];
  }

  function defaultAdShotProjects() {
    const now = deps.formatDate(new Date());
    return [
      { id: "proj_sea_social", name: "东南亚社交", tags: ["社交", "东南亚"], order: 1, status: "active", createdAt: now, updatedAt: now },
      { id: "proj_audio_reading", name: "听书阅读", tags: ["听书", "阅读", "书摘", "图书"], order: 2, status: "active", createdAt: now, updatedAt: now },
      { id: "proj_ai_photo", name: "AI 拍摄", tags: ["AI", "拍摄", "写真"], order: 3, status: "active", createdAt: now, updatedAt: now }
    ];
  }

  function normalizeAdShotProjects(projects) {
    const now = deps.formatDate(new Date());
    const rawProjects = Array.isArray(projects) && projects.length ? [...projects] : defaultAdShotProjects();
    if (Array.isArray(projects) && projects.length) {
      const hasReadingProject = rawProjects.some((project) => isReadingProject(project));
      if (!hasReadingProject) {
        const readingDefault = defaultAdShotProjects().find((project) => project.id === "proj_audio_reading");
        if (readingDefault) {
          rawProjects.push({
            ...readingDefault,
            order: Math.max(...rawProjects.map((project) => Number(project?.order) || 0), 0) + 1,
            createdAt: now,
            updatedAt: now
          });
        }
      }
    }
    const seen = new Set();
    return rawProjects
      .map((project, index) => {
        const name = deps.truncateText(normalizeText(project?.name), 80) || `项目 ${index + 1}`;
        const baseId = normalizeText(project?.id || project?.projectId || `proj_${deps.slugifyId(name) || index + 1}`);
        let id = baseId;
        let suffix = 2;
        while (seen.has(id)) {
          id = `${baseId}_${suffix}`;
          suffix += 1;
        }
        seen.add(id);
        return {
          id,
          name,
          tags: normalizeAdShotProjectTags(project?.tags || project?.tag || project?.keywords),
          order: Number(project?.order) || index + 1,
          status: ["active", "archived"].includes(project?.status) ? project.status : "active",
          createdAt: normalizeText(project?.createdAt) || now,
          updatedAt: normalizeText(project?.updatedAt) || now
        };
      })
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
      .map((project, index) => ({
        ...project,
        order: index + 1
      }));
  }

  function normalizeText(value) {
    return deps.normalizeText(value);
  }

  return {
    assignAdShotProjects,
    defaultAdShotProjects,
    normalizeAdShotProjects,
    readAdShotProjects,
    readAdShotProjectsWithStats,
    saveAdShotProjects,
    writeAdShotProjects
  };
}
