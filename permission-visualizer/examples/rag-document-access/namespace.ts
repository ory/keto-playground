import { Namespace, Context } from "@ory/keto-namespace-types"

class User implements Namespace {}

class Team implements Namespace {
  related: {
    members: User[]
  }
}

class Document implements Namespace {
  related: {
    owner: User[]
    editors: User[]
    viewers: (User | Team)[]
  }

  permits = {
    view: (ctx: Context): boolean =>
      this.related.owner.includes(ctx.subject) ||
      this.related.editors.includes(ctx.subject) ||
      this.related.viewers.includes(ctx.subject),

    edit: (ctx: Context): boolean =>
      this.related.owner.includes(ctx.subject) ||
      this.related.editors.includes(ctx.subject),

    include_in_rag: (ctx: Context): boolean =>
      this.related.owner.includes(ctx.subject) ||
      this.related.editors.includes(ctx.subject) ||
      this.related.viewers.includes(ctx.subject),
  }
}
