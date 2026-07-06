export async function fetchText(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`请求失败：${response.status}`);
  }
  return response.text();
}
