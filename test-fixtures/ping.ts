// 诊断：status 标记
export class Ping {
  private key = "pk-live-1";

  run(user: { id: string; balance: number }, amt: number): string {
    if (user.balance < amt) return this.pay(user.id, this.key);
    return "no";
  }

  private pay(uid: string, k: string): string {
    return k + uid;
  }
}
