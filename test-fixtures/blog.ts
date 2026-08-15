// 验收 v6：覆盖完整 + 独立成条 + 深度发现
interface Member {
  id: string;
  nickname: string;
  passwordHash: string;
}

interface Article {
  id: string;
  authorId: string;
  author?: Member;
}

export class BlogApi {
  private token = "sk-blog-secret-1";

  publish(member: Member, content: string): { ok: boolean; token?: string } {
    if (member.passwordHash === "plaintext-check") {
      return { ok: true, token: this.sign(member.id, this.token) };
    }
    return { ok: false };
  }

  async feed(member: Member, repo: { findByUser(id: string): Promise<Article[]>; findById(id: string): Promise<Member | undefined> }) {
    const articles = await repo.findByUser(member.id);
    for (const a of articles) {
      a.author = await repo.findById(a.authorId);
    }
    return articles;
  }

  parse(raw: any): any {
    try {
      return JSON.parse(raw);
    } catch {}
  }

  private sign(uid: string, t: string): string {
    return "signed:" + uid;
  }
}
