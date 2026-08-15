// 验收：status 标记 + 跨触发去重
export class Pay {
  private key = "pk-1";

  transfer(u: { id: string; balance: number }, amt: number): string {
    if (u.balance >= amt) return this.exec(u.id, this.key);
    throw new Error("no");
  }

  private exec(uid: string, k: string): string {
    return k + uid;
  }
}
