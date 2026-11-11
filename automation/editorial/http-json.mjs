export async function readJson(req) {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw Object.assign(new Error("JSON required"), { status: 415 });
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4 * 1024 * 1024)
      throw Object.assign(new Error("Payload too large"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw Object.assign(new Error("올바른 입력 형식이 아닙니다."), { status: 400 });
  }
}
