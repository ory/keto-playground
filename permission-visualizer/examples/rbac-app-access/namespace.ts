import { Namespace, Context } from "@ory/keto-namespace-types"

class User implements Namespace {}

class Role implements Namespace {
  related: {
    members: User[]
  }
}

class Application implements Namespace {
  related: {
    allowed_roles: Role[]
  }

  permits = {
    access: (ctx: Context): boolean =>
      this.related.allowed_roles.traverse((role) =>
        role.related.members.includes(ctx.subject)
      ),
  }
}
