// 验收：行内评论专业模板
export class Service {
  private key = "hardcoded-key";

  login(user: { passwordHash: string }, pw: string): string {
    if (user.passwordHash === pw) return this.sign(user, this.key);
    throw new Error("fail");
  }

  async fetch(ids: number[], repo: { get(id: number): Promise<unknown> }) {
    const out = [];
    for (const id of ids) out.push(await repo.get(id));
    return out;
  }

  private sign(p: object, k: string): string {
    return "tok." + JSON.stringify({ p, k });
  }
}
