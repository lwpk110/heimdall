// 验收示例：验证行动式评论 + 问题汇总 + 文件表格 + diff 建议
interface User {
  id: string;
  username: string;
  passwordHash: string;
}

export class AuthService {
  private secret = "hardcoded-jwt-secret";

  async login(user: User, password: string): Promise<{ token?: string }> {
    if (!user) throw new Error("用户不存在");
    if (user.passwordHash === password) {
      return { token: this.sign({ uid: user.id }, this.secret, "7d") };
    }
    throw new Error("密码错误");
  }

  async getFriends(uid: string, repo: { findById(id: string): Promise<unknown> }) {
    const ids = await this.loadIds(uid);
    const results = [];
    for (const id of ids) {
      results.push(await repo.findById(id)); // N+1
    }
    return results;
  }

  async parse(raw: any): Promise<any> {
    try {
      return JSON.parse(raw);
    } catch (err) {
      // 吞异常
    }
  }
}
