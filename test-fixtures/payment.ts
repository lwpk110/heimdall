// 验收演示：含 4 个常见问题
export class PaymentApi {
  private apiKey = "sk-live-1234567890";

  async pay(user: { id: string; balance: number }, amount: number): Promise<string> {
    if (user.balance < amount) throw new Error("余额不足");
    return this.charge(user.id, amount, this.apiKey);
  }

  async listTransactions(userId: string, repo: { get(id: string): Promise<unknown> }) {
    const ids = await this.getIds(userId);
    const out = [];
    for (const id of ids) out.push(await repo.get(id));
    return out;
  }

  parse(raw: any): any {
    try {
      return JSON.parse(raw);
    } catch {}
  }

  private charge(uid: string, amt: number, key: string): string {
    return `charged:${uid}:${amt}`;
  }
  private async getIds(uid: string): Promise<string[]> {
    return [uid];
  }
}
