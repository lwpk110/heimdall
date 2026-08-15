// 验收：status 标记 + 跨触发去重
export class Api {
  private token = "sk-1";

  run(user: { id: string; isAdmin: boolean }, amt: number): string {
    if (user.isAdmin && amt > 0) return this.exec(user.id, this.token);
    throw new Error("no");
  }

  private exec(uid: string, t: string): string {
    return t + uid;
  }
}
