// 验收：验证 Worker 行内评论（Files changed 显示）
interface User {
  id: string;
  passwordHash: string;
}

export class Api {
  private secret = "hardcoded-key";

  async auth(user: User, pw: string): Promise<string> {
    if (user.passwordHash === pw) return this.sign(user.id, this.secret);
    throw new Error("fail");
  }

  async batch(ids: number[], r: { get(id: number): Promise<unknown> }) {
    const out = [];
    for (const id of ids) out.push(await r.get(id));
    return out;
  }

  async raw(v: any): Promise<any> {
    try {
      return JSON.parse(v);
    } catch {}
  }
}
