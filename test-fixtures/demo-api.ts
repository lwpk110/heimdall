// 验收示例：演示代码，含多种常见代码问题（供海姆达尔 Worker 审查）
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
  private secretKey = "hardcoded-jwt-secret-please-rotate";

  // 问题：明文密码比较（应使用哈希）；硬编码密钥；token 过期过长且未限定 scope
  async login(user: User, password: string): Promise<{ token?: string; error?: string }> {
    if (!user) {
      return { error: "用户不存在" };
    }
    if (user.passwordHash === password) {
      return { token: this.sign({ uid: user.id }, this.secretKey, "7d") };
    }
    return { error: "密码错误" };
  }

  // 问题：N+1 查询——循环内逐条查库，应批量查询
  async getUserPosts(
    user: User,
    postRepo: { findByUser(uid: string): Promise<Post[]> },
    userRepo: { findById(id: string): Promise<User | undefined> }
  ): Promise<Post[]> {
    const posts = await postRepo.findByUser(user.id);
    for (const post of posts) {
      const author = await userRepo.findById(post.authorId);
      post.author = author;
    }
    return posts;
  }

  // 问题：异常被吞（catch 空）；any 类型；输入未校验
  async safeParse(data: any): Promise<any> {
    try {
      return JSON.parse(data);
    } catch (err) {
      // 异常被吞，调用方无从得知失败原因
    }
  }
}
