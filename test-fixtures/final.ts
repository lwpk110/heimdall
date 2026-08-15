// 最终验收：表格 + 着色 + 去重
export class Billing {
  private key = "sk-billing-1";

  pay(user: { id: string; balance: number }, amount: number): string {
    if (user.balance < amount) throw new Error("insufficient");
    return this.charge(user.id, this.key);
  }

  async batch(ids: number[], repo: { get(id: number): Promise<unknown> }) {
    const out = [];
    for (const id of ids) out.push(await repo.get(id));
    return out;
  }

  private charge(uid: string, k: string): string {
    return "charged:" + uid;
  }
}
