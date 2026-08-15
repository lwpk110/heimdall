// 验收：表格汇总 + 去重 + emoji 着色
export class Account {
  private secret = "sk-live-111";

  transfer(user: { id: string; balance: number }, to: string, amount: number): string {
    if (user.balance < amount) throw new Error("余额不足");
    return this.pay(user.id, to, this.secret);
  }

  async history(ids: number[], repo: { get(id: number): Promise<unknown> }) {
    const out = [];
    for (const id of ids) out.push(await repo.get(id));
    return out;
  }

  parse(raw: any): any {
    try {
      return JSON.parse(raw);
    } catch {}
  }

  private pay(uid: string, to: string, s: string): string {
    return `paid:${uid}->${to}`;
  }
}
