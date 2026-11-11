// 글쓰기 HTTP 계약의 얇은 클라이언트 · 정책은 서버가 소유 · AGENT-001
export class AinClient {
  constructor({ baseUrl, token, fetch: fetchImpl = fetch }) {
    Object.assign(this, { baseUrl: baseUrl.replace(/\/$/, ""), token, fetchImpl });
  }
  async request(path, { body, raw = false } = {}) {
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/write/api/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new CliError("AIN 서비스에 연결하지 못했습니다. `mise run editorial`을 확인해 주세요.");
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new CliError(data.error ?? `요청 실패 (${response.status})`, response.status);
    }
    return raw ? response.text() : response.json();
  }
  list = () => this.request("runs").then((data) => data.runs);
  get = (id) => this.request(`runs/${id}`);
  history = (id) => this.request(`runs/${id}/history`);
  create = (body) => this.request("runs", { body });
  action = (id, body) => this.request(`runs/${id}/actions`, { body });
  archive = (id) => this.request(`runs/${id}/archive`, { body: {} });
  download = (id, revision) =>
    this.request(`runs/${id}/download${revision ? `?revision=${Number(revision)}` : ""}`, {
      raw: true,
    });
}

export class CliError extends Error {
  constructor(message, status = null) {
    super(message);
    this.status = status;
  }
}
