// 验收：body 与行内评论去重
export class Order {
  private token = "sk-xyz";

  create(user: { id: string; isAdmin: boolean }, total: number): string {
    if (!user.isAdmin) throw new Error("无权限");
    return this.bill(user.id, this.token);
  }

  async list(ids: number[], repo: { get(id: number): Promise<unknown> }) {
    const out = [];
    for (const id of ids) out.push(await repo.get(id));
    return out;
  }

  private bill(uid: string, t: string): string {
    return `billed:${uid}`;
  }
}
