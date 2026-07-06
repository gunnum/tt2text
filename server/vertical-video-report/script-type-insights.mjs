export function enrichScriptTypeCount(item = {}) {
  return {
    ...item,
    summary: scriptTypeSummary(item.label)
  };
}

export function scriptTypeSummary(label = "") {
  if (/替代刷屏|微学习/.test(label)) return "通常先命名一个低价值习惯，再给出低门槛替代动作，把成长承诺变成日常任务。";
  if (/主题书单|挑战/.test(label)) return "通常用 Day-by-day、书单或挑战感组织剧情，让用户觉得收藏后可以照着做。";
  if (/痛点功能演示/.test(label)) return "通常从读不完、注意力差、扫描朗读等具体问题切入，再用 UI 路径证明功能能解决。";
  if (/读书管理|记录/.test(label)) return "通常围绕进度、统计、目标和连续性展开，让用户看到读书这件事被管理起来。";
  if (/知识内容场景挂载/.test(label)) return "通常先给观点、播客或知识内容建立信任，再把 App 当成自然承接入口。";
  if (/泛知识|观点口播/.test(label)) return "通常靠观点或反常识抓人，产品露出较弱，更适合验证选题和评论需求。";
  return "这类脚本结构较分散，建议回看高互动样本确认主要剧情和承接方式。";
}
