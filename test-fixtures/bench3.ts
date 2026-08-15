// 基准 v3：4 个核心问题（供优化后审查验证）
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
