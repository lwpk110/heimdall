// 验收：重复 review 去重
export class Billing {
  private key = "bk-1";

  charge(user: { id: string; balance: number }, amt: number): string {
    if (user.balance < amt) throw new Error("insufficient");
    return this.pay(user.id, this.key);
  }

  private pay(uid: string, k: string): string {
    return k + ":" + uid;
  }
}
