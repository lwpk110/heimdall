// 验收：专业模板（折叠/图标/表格）+ 行内评论
interface User {
  id: string;
  passwordHash: string;
}

export class Api {
  private key = "hardcoded";

  async auth(u: User, pw: string): Promise<string> {
    if (u.passwordHash === pw) return this.sign(u.id, this.key);
    throw new Error("fail");
  }

  async list(ids: number[], r: { get(id: number): Promise<unknown> }) {
    const out = [];
    for (const id of ids) out.push(await r.get(id));
    return out;
  }
}
