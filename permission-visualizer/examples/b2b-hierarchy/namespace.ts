import { Namespace, Context } from "@ory/keto-namespace-types"

class User implements Namespace {}

class Business implements Namespace {
  related: {
    admins: User[]
    viewers: User[]
  }
}

class LineOfBusiness implements Namespace {
  related: {
    parent: Business[]
    managers: User[]
    viewers: User[]
  }

  permits = {
    view: (ctx: Context): boolean =>
      this.related.viewers.includes(ctx.subject) ||
      this.related.managers.includes(ctx.subject) ||
      this.related.parent.traverse((biz) =>
        biz.related.viewers.includes(ctx.subject)
      ) ||
      this.related.parent.traverse((biz) =>
        biz.related.admins.includes(ctx.subject)
      ),

    manage: (ctx: Context): boolean =>
      this.related.managers.includes(ctx.subject) ||
      this.related.parent.traverse((biz) =>
        biz.related.admins.includes(ctx.subject)
      ),
  }
}

class Customer implements Namespace {
  related: {
    parent_lob: LineOfBusiness[]
    account_managers: User[]
    viewers: User[]
  }

  permits = {
    view: (ctx: Context): boolean =>
      this.related.viewers.includes(ctx.subject) ||
      this.related.account_managers.includes(ctx.subject) ||
      this.related.parent_lob.traverse((lob) =>
        lob.permits.view(ctx)
      ),

    manage: (ctx: Context): boolean =>
      this.related.account_managers.includes(ctx.subject) ||
      this.related.parent_lob.traverse((lob) =>
        lob.permits.manage(ctx)
      ),
  }
}
