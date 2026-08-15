// 验收：默认仅按需审查
export class Cart {
  private key = "ck-1";

  buy(user: { id: string; balance: number }, price: number): string {
    if (user.balance >= price) return this.pay(user.id, this.key);
    throw new Error("no");
  }

  private pay(uid: string, k: string): string {
    return k + uid;
  }
}
