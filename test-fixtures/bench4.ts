// 基准 v4：4 个核心问题（验证行号校验 + 信任边界）
export class Auth {
  private key = "hardcoded-secret";

  login(user: { passwordHash: string }, pw: string): string {
    if (user.passwordHash === pw) return this.sign(user, this.key);
    throw new Error("fail");
  }

  async getOrders(ids: number[], repo: { get(id: number): Promise<unknown> }) {
    const out = [];
    for (const id of ids) out.push(await repo.get(id));
    return out;
  }

  parse(raw: any): any {
    try {
      return JSON.parse(raw);
    } catch {}
  }

  private sign(p: object, k: string): string {
    return "tok." + JSON.stringify({ p, k });
  }
}
