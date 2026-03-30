/**
 * OPL (Ory Permission Language) schema source for each bundled example.
 * These are the raw TypeScript namespace definitions that get loaded into
 * Ory Keto via `ory update opl --file namespace.ts`.
 *
 * Embedded here as strings so they can be displayed and edited in the
 * offline playground without requiring file-system access at runtime.
 */

const OPL_SCHEMAS = {
  "rbac-app-access": `import { Namespace, Context } from "@ory/keto-namespace-types"

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
`,

  "rbac-bank-accounts": `import { Namespace, Context } from "@ory/keto-namespace-types"

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
`,

  "rag-document-access": `import { Namespace, Context } from "@ory/keto-namespace-types"

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
`,

  "b2b-hierarchy": `import { Namespace, Context } from "@ory/keto-namespace-types"

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
`,

  "saas-feature-gating": `import { Namespace, Context } from "@ory/keto-namespace-types"

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
`,

  "healthcare-records": `import { Namespace, Context } from "@ory/keto-namespace-types"

class User implements Namespace {}

class CareTeam implements Namespace {
  related: {
    doctors: User[]
    nurses: User[]
  }
}

class Patient implements Namespace {
  related: {
    care_team_doctors: User[]
    care_team_nurses: User[]
    consented_viewers: User[]
  }

  permits = {
    view_records: (ctx: Context): boolean =>
      this.related.care_team_doctors.includes(ctx.subject) ||
      this.related.care_team_nurses.includes(ctx.subject) ||
      this.related.consented_viewers.includes(ctx.subject),

    edit_records: (ctx: Context): boolean =>
      this.related.care_team_doctors.includes(ctx.subject),
  }
}

class MedicalRecord implements Namespace {
  related: {
    patient: Patient[]
    emergency_access: User[]
  }

  permits = {
    view: (ctx: Context): boolean =>
      this.related.emergency_access.includes(ctx.subject) ||
      this.related.patient.traverse((p) =>
        p.permits.view_records(ctx)
      ),

    edit: (ctx: Context): boolean =>
      this.related.patient.traverse((p) =>
        p.permits.edit_records(ctx)
      ),
  }
}
`,

  "content-publishing-workflow": `import { Namespace, Context } from "@ory/keto-namespace-types"

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
`,
};

export default OPL_SCHEMAS;
