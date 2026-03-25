# SaaS Feature Gating

Multi-Tenant SaaS with Subscription-Based Feature Access. Organizations subscribe to Plans (free, pro, enterprise). Plans unlock Features. Users belong to Organizations and can only use Features their org's plan includes.

## Permission Model

```
User ──member/admin──▶ Organization ──(via Plan.org_members)──▶ Plan ◄──included_in── Feature
```

### Permission Logic

`Feature.use`: traverse from Feature → Plans that include it → Organizations subscribed to those Plans → check if subject is a member/admin of that Organization.

### Plans & Features

| Feature             | free | pro | enterprise |
|---------------------|------|-----|------------|
| basic-dashboard     | yes  | yes | yes        |
| api-access          | yes  | yes | yes        |
| export-csv          | yes  | yes | yes        |
| custom-branding     | —    | yes | yes        |
| sso                 | —    | yes | yes        |
| audit-log           | —    | yes | yes        |
| advanced-analytics  | —    | —   | yes        |
| priority-support    | —    | —   | yes        |
| dedicated-infra     | —    | —   | yes        |

### Organizations

- **startup-co** (free): alice (admin), bob, charlie
- **growth-co** (pro): diana (admin), eve, frank, grace
- **megacorp** (enterprise): henry (admin), irene (admin), jack, karen, leo

## Exhaustive Expected Permissions (117 checks — all verified)

| User    | basic-dash | api-access | export-csv | custom-brand | sso     | audit-log | adv-analytics | priority-sup | dedicated-infra |
|---------|------------|------------|------------|--------------|---------|-----------|---------------|--------------|-----------------|
| alice   | Allowed    | Allowed    | Allowed    | Denied       | Denied  | Denied    | Denied        | Denied       | Denied          |
| bob     | Allowed    | Allowed    | Allowed    | Denied       | Denied  | Denied    | Denied        | Denied       | Denied          |
| charlie | Allowed    | Allowed    | Allowed    | Denied       | Denied  | Denied    | Denied        | Denied       | Denied          |
| diana   | Allowed    | Allowed    | Allowed    | Allowed      | Allowed | Allowed   | Denied        | Denied       | Denied          |
| eve     | Allowed    | Allowed    | Allowed    | Allowed      | Allowed | Allowed   | Denied        | Denied       | Denied          |
| frank   | Allowed    | Allowed    | Allowed    | Allowed      | Allowed | Allowed   | Denied        | Denied       | Denied          |
| grace   | Allowed    | Allowed    | Allowed    | Allowed      | Allowed | Allowed   | Denied        | Denied       | Denied          |
| henry   | Allowed    | Allowed    | Allowed    | Allowed      | Allowed | Allowed   | Allowed       | Allowed      | Allowed         |
| irene   | Allowed    | Allowed    | Allowed    | Allowed      | Allowed | Allowed   | Allowed       | Allowed      | Allowed         |
| jack    | Allowed    | Allowed    | Allowed    | Allowed      | Allowed | Allowed   | Allowed       | Allowed      | Allowed         |
| karen   | Allowed    | Allowed    | Allowed    | Allowed      | Allowed | Allowed   | Allowed       | Allowed      | Allowed         |
| leo     | Allowed    | Allowed    | Allowed    | Allowed      | Allowed | Allowed   | Allowed       | Allowed      | Allowed         |
| nobody  | Denied     | Denied     | Denied     | Denied       | Denied  | Denied    | Denied        | Denied       | Denied          |

## Test Commands

```bash
source .env

# Free plan: basic features only
ory is allowed alice use Feature basic-dashboard --project $ORY_PROJECT --workspace $ORY_WORKSPACE
ory is allowed bob use Feature sso --project $ORY_PROJECT --workspace $ORY_WORKSPACE  # Denied

# Pro plan: basic + pro features
ory is allowed diana use Feature sso --project $ORY_PROJECT --workspace $ORY_WORKSPACE
ory is allowed eve use Feature dedicated-infra --project $ORY_PROJECT --workspace $ORY_WORKSPACE  # Denied

# Enterprise: everything
ory is allowed henry use Feature dedicated-infra --project $ORY_PROJECT --workspace $ORY_WORKSPACE

# No org: denied everything
ory is allowed nobody use Feature basic-dashboard --project $ORY_PROJECT --workspace $ORY_WORKSPACE  # Denied
```
