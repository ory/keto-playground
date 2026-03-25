import { Namespace, Context } from "@ory/keto-namespace-types"

class User implements Namespace {}

class Role implements Namespace {
  related: {
    members: User[]
  }
}

class Article implements Namespace {
  related: {
    author: User[]
    assigned_editor: User[]
    draft_editors: User[]
    review_editors: User[]
    review_publishers: Role[]
    published_viewers: Role[]
  }

  permits = {
    view: (ctx: Context): boolean =>
      this.related.author.includes(ctx.subject) ||
      this.related.assigned_editor.includes(ctx.subject) ||
      this.related.published_viewers.traverse((role) =>
        role.related.members.includes(ctx.subject)
      ),

    edit: (ctx: Context): boolean =>
      this.related.draft_editors.includes(ctx.subject) ||
      this.related.review_editors.includes(ctx.subject),

    approve: (ctx: Context): boolean =>
      this.related.review_editors.includes(ctx.subject),

    publish: (ctx: Context): boolean =>
      this.related.review_publishers.traverse((role) =>
        role.related.members.includes(ctx.subject)
      ),
  }
}
