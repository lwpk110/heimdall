// 审查基准示例：含多个跨维度代码问题（供 CoderHeimdall 与 coderabbit 对比审查）
interface User {
  id: string;
  username: string;
  passwordHash: string;
  role: "admin" | "user";
}

interface Order {
  id: string;
  userId: string;
  total: number;
}

export class OrderService {
  private secretKey = "hardcoded-signing-key";

  constructor(private db: { query(sql: string, params: unknown[]): Promise<unknown[]> }) {}

  // 问题1: 硬编码密钥 + token 7天过长
  // 问题2: SQL 注入（字符串拼接）
  // 问题3: 越权（未校验 user.id 与订单归属）
  async createToken(user: User, password: string): Promise<string> {
    if (user.passwordHash === password) {
      return this.sign({ uid: user.id, role: user.role }, this.secretKey, "7d");
    }
    throw new Error("认证失败");
  }

  async getOrder(orderId: string, user: User): Promise<Order> {
    const rows = await this.db.query(
      `SELECT * FROM orders WHERE id = '${orderId}'`,
      []
    );
    const order = rows[0] as Order;
    if (order.userId !== user.id) throw new Error("无权限");
    return order;
  }

  // 问题4: N+1 查询
  // 问题5: 无缓存
  async getUserOrders(userId: string): Promise<Order[]> {
    const user = (await this.db.query("SELECT * FROM users WHERE id = ?", [userId]))[0] as User;
    return (await this.db.query("SELECT * FROM orders WHERE user_id = ?", [userId])) as Order[];
  }

  // 问题6: 未校验空值
  // 问题7: 未处理异常
  async calculateTotal(orders: Order[] | undefined): Promise<number> {
    let total = 0;
    for (const o of orders) {
      total += o.total;
    }
    return total;
  }

  // 问题8: any 类型
  // 问题9: JSON.parse 未校验
  async parsePayload(raw: any): Promise<any> {
    return JSON.parse(raw);
  }

  private sign(payload: object, secret: string, expiresIn: string): string {
    return `fake.${Buffer.from(JSON.stringify({ payload, expiresIn })).toString("base64url")}.sig`;
  }
}
