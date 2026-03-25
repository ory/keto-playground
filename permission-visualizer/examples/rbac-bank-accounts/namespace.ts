import { Namespace, Context } from "@ory/keto-namespace-types"

class User implements Namespace {}

class Role implements Namespace {
  related: {
    members: User[]
  }
}

class BankAccount implements Namespace {
  related: {
    owners: User[]
    spouses: User[]
    children: User[]
    viewers_direct: User[]
    viewers_role: Role[]
    transferors_direct: User[]
    transferors_role: Role[]
    admins: Role[]
  }

  permits = {
    view: (ctx: Context): boolean =>
      this.related.owners.includes(ctx.subject) ||
      this.related.spouses.includes(ctx.subject) ||
      this.related.children.includes(ctx.subject) ||
      this.related.viewers_direct.includes(ctx.subject) ||
      this.related.viewers_role.traverse((role) =>
        role.related.members.includes(ctx.subject)
      ) ||
      this.related.admins.traverse((role) =>
        role.related.members.includes(ctx.subject)
      ),

    transfer: (ctx: Context): boolean =>
      this.related.owners.includes(ctx.subject) ||
      this.related.spouses.includes(ctx.subject) ||
      this.related.transferors_direct.includes(ctx.subject) ||
      this.related.transferors_role.traverse((role) =>
        role.related.members.includes(ctx.subject)
      ) ||
      this.related.admins.traverse((role) =>
        role.related.members.includes(ctx.subject)
      ),

    limited_transfer: (ctx: Context): boolean =>
      this.related.children.includes(ctx.subject) ||
      this.related.owners.includes(ctx.subject) ||
      this.related.spouses.includes(ctx.subject) ||
      this.related.transferors_direct.includes(ctx.subject) ||
      this.related.transferors_role.traverse((role) =>
        role.related.members.includes(ctx.subject)
      ) ||
      this.related.admins.traverse((role) =>
        role.related.members.includes(ctx.subject)
      ),

    admin: (ctx: Context): boolean =>
      this.related.owners.includes(ctx.subject) ||
      this.related.admins.traverse((role) =>
        role.related.members.includes(ctx.subject)
      ),
  }
}
