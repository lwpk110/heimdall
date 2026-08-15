// 评估基准 diff：与 coderabbit 审查过的 demo-api.ts 相同（PR #44 基准）
interface User {
  id: string;
  username: string;
  passwordHash: string;
}

interface Post {
  id: string;
  authorId: string;
  author?: User;
}

export class DemoApi {
  private secretKey = "hardcoded-jwt-secret-should-not-be-in-code";

  // 问题 1：明文密码比较（应使用哈希）；问题 2：硬编码密钥
  // 问题 3：token 过期 7 天过长、未限定 scope
  async login(user: User, password: string): Promise<{ token?: string; error?: string }> {
    if (!user) {
      return { error: "用户不存在" };
    }
    if (user.passwordHash === password) {
      return { token: this.sign({ uid: user.id }, this.secretKey, "7d") };
    }
    return { error: "密码错误" };
  }

  // 问题 4：N+1 查询——循环内逐条查库，应批量查询
  async getUserPosts(user: User, postRepo: { findByUser(uid: string): Promise<Post[]> }, userRepo: { findById(id: string): Promise<User | undefined> }) {
    const posts = await postRepo.findByUser(user.id);
    for (const post of posts) {
      const author = await userRepo.findById(post.authorId);
      post.author = author;
    }
    return posts;
  }

  // 问题 5：吞掉异常（catch 空）；问题 6：any 类型（类型安全缺失）
  // 问题 7：JSON.parse 的输入未校验
  async safeParse(data: any): Promise<any> {
    try {
      return JSON.parse(data);
    } catch (err) {
      // 异常被吞，调用方无从得知失败原因
    }
  }
}
