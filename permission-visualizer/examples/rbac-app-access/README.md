# RBAC App Access

Role-Based Access Control for Applications. Users are assigned to Roles, and Roles grant access to Applications.

## Permission Model

```
User ──member──▶ Role ──allowed_role──▶ Application
```

- **User**: 15 users across 5 roles
- **Role**: admin, editor, viewer, support, developer
- **Application**: billing-dashboard, content-cms, analytics-viewer, helpdesk-portal, ci-cd-pipeline, staging-env, internal-wiki

### Permission Logic

`Application.access`: subject is a member of any role that is an `allowed_role` on the application.

### Access Matrix (by Role)

| Application        | admin | editor | viewer | support | developer |
|--------------------|-------|--------|--------|---------|-----------|
| billing-dashboard  | yes   | no     | no     | no      | no        |
| content-cms        | yes   | yes    | no     | no      | no        |
| analytics-viewer   | yes   | yes    | yes    | no      | no        |
| helpdesk-portal    | yes   | no     | no     | yes     | no        |
| ci-cd-pipeline     | yes   | no     | no     | no      | yes       |
| staging-env        | yes   | yes    | no     | no      | yes       |
| internal-wiki      | yes   | yes    | yes    | yes     | yes       |

### Users by Role

- **admin**: alice, bob, greg
- **editor**: charlie, diana, helen, ivan
- **viewer**: eve, frank, judy
- **support**: karen, leo
- **developer**: mike, nancy, oscar

## Exhaustive Expected Permissions (105 checks — all verified)

| User    | billing-dashboard | content-cms | analytics-viewer | helpdesk-portal | ci-cd-pipeline | staging-env | internal-wiki |
|---------|-------------------|-------------|------------------|-----------------|----------------|-------------|---------------|
| alice   | Allowed           | Allowed     | Allowed          | Allowed         | Allowed        | Allowed     | Allowed       |
| bob     | Allowed           | Allowed     | Allowed          | Allowed         | Allowed        | Allowed     | Allowed       |
| greg    | Allowed           | Allowed     | Allowed          | Allowed         | Allowed        | Allowed     | Allowed       |
| charlie | Denied            | Allowed     | Allowed          | Denied          | Denied         | Allowed     | Allowed       |
| diana   | Denied            | Allowed     | Allowed          | Denied          | Denied         | Allowed     | Allowed       |
| helen   | Denied            | Allowed     | Allowed          | Denied          | Denied         | Allowed     | Allowed       |
| ivan    | Denied            | Allowed     | Allowed          | Denied          | Denied         | Allowed     | Allowed       |
| eve     | Denied            | Denied      | Allowed          | Denied          | Denied         | Denied      | Allowed       |
| frank   | Denied            | Denied      | Allowed          | Denied          | Denied         | Denied      | Allowed       |
| judy    | Denied            | Denied      | Allowed          | Denied          | Denied         | Denied      | Allowed       |
| karen   | Denied            | Denied      | Denied           | Allowed         | Denied         | Denied      | Allowed       |
| leo     | Denied            | Denied      | Denied           | Allowed         | Denied         | Denied      | Allowed       |
| mike    | Denied            | Denied      | Denied           | Denied          | Allowed        | Allowed     | Allowed       |
| nancy   | Denied            | Denied      | Denied           | Denied          | Allowed        | Allowed     | Allowed       |
| oscar   | Denied            | Denied      | Denied           | Denied          | Allowed        | Allowed     | Allowed       |

## Test Commands

```bash
source .env

# Admin can access everything
ory is allowed alice access Application billing-dashboard --project $ORY_PROJECT --workspace $ORY_WORKSPACE
ory is allowed greg access Application ci-cd-pipeline --project $ORY_PROJECT --workspace $ORY_WORKSPACE

# Editor can access content-cms, analytics, staging, wiki — not billing, helpdesk, ci-cd
ory is allowed charlie access Application content-cms --project $ORY_PROJECT --workspace $ORY_WORKSPACE
ory is allowed helen access Application billing-dashboard --project $ORY_PROJECT --workspace $ORY_WORKSPACE  # Denied

# Viewer can access analytics, wiki only
ory is allowed eve access Application analytics-viewer --project $ORY_PROJECT --workspace $ORY_WORKSPACE
ory is allowed judy access Application ci-cd-pipeline --project $ORY_PROJECT --workspace $ORY_WORKSPACE  # Denied

# Support can access helpdesk and wiki
ory is allowed karen access Application helpdesk-portal --project $ORY_PROJECT --workspace $ORY_WORKSPACE
ory is allowed leo access Application billing-dashboard --project $ORY_PROJECT --workspace $ORY_WORKSPACE  # Denied

# Developer can access ci-cd, staging, wiki
ory is allowed mike access Application ci-cd-pipeline --project $ORY_PROJECT --workspace $ORY_WORKSPACE
ory is allowed oscar access Application helpdesk-portal --project $ORY_PROJECT --workspace $ORY_WORKSPACE  # Denied
```
