// 批评家基准：含 7 个典型问题，供 CoderHeimdall 与 coderabbit 审查对比
export class AuthApi {
  private key = "hardcoded-secret-1";

  login(user: { id: string; passwordHash: string }, pw: string): string {
    if (user.passwordHash === pw) return this.sign(user.id, this.key);
    throw new Error("auth failed");
  }

  async list(ids: number[], repo: { get(id: number): Promise<unknown> }) {
    const out = [];
    for (const id of ids) out.push(await repo.get(id));
    return out;
  }

  parse(raw: any): any {
    try {
      return JSON.parse(raw);
    } catch {}
  }

  private sign(uid: string, k: string): string {
    return "tok." + uid;
  }
}
