import { Namespace, Context } from "@ory/keto-namespace-types"

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
