import { Namespace, SubjectSet, Context } from "@ory/keto-namespace-types"

class User implements Namespace {}

/** Groups nest: a group's members include the members of its child groups. */
class Group implements Namespace {
  related: {
    members: (User | SubjectSet<Group, "members">)[]
  }
}

class Role implements Namespace {
  related: {
    holders: (User | SubjectSet<Group, "members">)[]
  }
}

/** A model class; resources scoped to one are named `<base>/<class>`. */
class ClaudeClass implements Namespace {
  related: {
    members: (User | SubjectSet<Group, "members">)[]
  }
}

class Folder implements Namespace {
  related: {
    parents: Folder[]
    owners: (User | SubjectSet<Group, "members">)[]
    editors: (User | SubjectSet<Group, "members"> | SubjectSet<Role, "holders">)[]
    viewers: (User | SubjectSet<Group, "members"> | SubjectSet<Role, "holders">)[]
  }

  permits = {
    own: (ctx: Context): boolean =>
      this.related.owners.includes(ctx.subject) ||
      this.related.parents.traverse((p) => p.permits.own(ctx)),

    edit: (ctx: Context): boolean =>
      this.related.editors.includes(ctx.subject) ||
      this.permits.own(ctx) ||
      this.related.parents.traverse((p) => p.permits.edit(ctx)),

    view: (ctx: Context): boolean =>
      this.related.viewers.includes(ctx.subject) ||
      this.permits.edit(ctx) ||
      this.related.parents.traverse((p) => p.permits.view(ctx)),
  }
}

class Document implements Namespace {
  related: {
    parents: Folder[]
    owners: User[]
    editors: (User | SubjectSet<Group, "members">)[]
    viewers: (User | SubjectSet<Group, "members"> | SubjectSet<ClaudeClass, "members">)[]
  }

  permits = {
    edit: (ctx: Context): boolean =>
      this.related.owners.includes(ctx.subject) ||
      this.related.editors.includes(ctx.subject) ||
      this.related.parents.traverse((p) => p.permits.edit(ctx)),

    view: (ctx: Context): boolean =>
      this.related.viewers.includes(ctx.subject) ||
      this.permits.edit(ctx) ||
      this.related.parents.traverse((p) => p.permits.view(ctx)),
  }
}
