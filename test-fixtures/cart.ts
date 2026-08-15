// 验收：宽松 JSON 修复后整体报告
export class Cart {
  private token = "sk-abc123";

  checkout(user: { id: string; balance: number }, total: number): string {
    if (user.balance < total) throw new Error("余额不足");
    return this.authorize(user.id, this.token);
  }

  async load(ids: number[], repo: { get(id: number): Promise<unknown> }) {
    const out = [];
    for (const id of ids) out.push(await repo.get(id));
    return out;
  }

  parse(raw: any): any {
    try {
      return JSON.parse(raw);
    } catch {}
  }

  private authorize(uid: string, t: string): string {
    return `auth:${uid}`;
  }
}
