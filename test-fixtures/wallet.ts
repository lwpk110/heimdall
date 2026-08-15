// 验收：缓存去重
export class Wallet {
  private key = "wk-1";

  pay(user: { id: string; balance: number }, amt: number): string {
    if (user.balance < amt) throw new Error("no");
    return this.exec(user.id, this.key);
  }

  private exec(uid: string, k: string): string {
    return k + uid;
  }
}
