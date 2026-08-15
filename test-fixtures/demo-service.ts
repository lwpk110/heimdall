// 验收示例：含多个常见代码问题，验证 diff 建议与文件表格
interface User {
  id: string;
  username: string;
  passwordHash: string;
}

export class DemoService {
  private secretKey = "hardcoded-secret";

  async login(user: User, password: string): Promise<{ token?: string }> {
    if (!user) throw new Error("用户不存在");
    if (user.passwordHash === password) {
      return { token: this.sign({ uid: user.id }, this.secretKey, "7d") };
    }
    throw new Error("密码错误");
  }

  async listPosts(ids: number[], repo: { findById(id: number): Promise<unknown> }) {
    const results = [];
    for (const id of ids) {
      results.push(await repo.findById(id)); // N+1
    }
    return results;
  }
}
