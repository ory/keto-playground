import { Namespace, Context } from "@ory/keto-namespace-types"

class User implements Namespace {}

class Organization implements Namespace {
  related: {
    members: User[]
    admins: User[]
  }
}

class Plan implements Namespace {
  related: {
    org_members: Organization[]
  }
}

class Feature implements Namespace {
  related: {
    included_in: Plan[]
  }

  permits = {
    use: (ctx: Context): boolean =>
      this.related.included_in.traverse((plan) =>
        plan.related.org_members.includes(ctx.subject)
      ),
  }
}
