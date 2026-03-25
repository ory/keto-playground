# RAG Document Access

Document Access Control for RAG Pipelines. Users own or are granted access to Documents. Only documents the user can access are allowed into their RAG context.

## Permission Model

```
User ──member──▶ Team ──viewers──▶ Document
User ──owner/editor/viewer──▶ Document
```

- **User**: 11 users (alice, bob, charlie, oscar, diana, eve, frank, grace, henry, irene, jack)
- **Team**: engineering (4), marketing (3), design (2), leadership (2)
- **Document**: 15 documents with mixed access patterns

### Permission Logic

- `Document.view`: owner OR editor OR viewer (direct or via team membership)
- `Document.edit`: owner OR editor only
- `Document.include_in_rag`: same as view — if user can see it, it can be in their RAG context

Team-based viewer access uses subject sets (`Team:X#members`), which Keto resolves automatically via `includes()`.

### Teams

- **engineering**: alice, bob, charlie, oscar
- **marketing**: diana, eve, frank
- **design**: grace, henry
- **leadership**: irene, jack

### Documents

| Document                | Owner  | Editors       | Viewers                              |
|-------------------------|--------|---------------|--------------------------------------|
| api-design-doc          | alice  | bob           | engineering team                     |
| deployment-runbook      | bob    | —             | engineering team                     |
| alice-private-notes     | alice  | —             | — (private)                          |
| brand-guidelines        | diana  | —             | marketing team, design team          |
| campaign-plan           | eve    | diana         | marketing team                       |
| cross-team-roadmap      | alice  | —             | engineering, marketing, design, leadership |
| shared-spec             | bob    | diana         | frank                                |
| eve-private-draft       | eve    | —             | — (private)                          |
| design-system-v2        | grace  | henry         | design team, engineering team        |
| ux-research-findings    | henry  | —             | design team, marketing team          |
| board-deck-q4           | irene  | jack          | leadership team                      |
| org-restructure-plan    | jack   | —             | — (private)                          |
| budget-forecast         | irene  | —             | alice, diana (individual grants)     |
| product-launch-brief    | diana  | grace, alice  | marketing, engineering, design teams |
| incident-postmortem-42  | oscar  | —             | engineering team                     |

## Exhaustive Expected Permissions (495 checks — all verified)

Format: V=view, E=edit, R=include_in_rag. Y=Allowed, N=Denied. (R always matches V)

| User    | api-design | deploy-run | alice-priv | brand-gui | campaign | cross-road | shared-spec | eve-priv | design-v2 | ux-research | board-q4 | org-restr | budget-fc | prod-launch | incident-42 |
|---------|------------|------------|------------|-----------|----------|------------|-------------|----------|-----------|-------------|----------|-----------|-----------|-------------|-------------|
| alice   | VY EY RY   | VY EN RY   | VY EY RY   | VN EN RN  | VN EN RN | VY EY RY   | VN EN RN    | VN EN RN | VY EN RY  | VN EN RN    | VN EN RN | VN EN RN  | VY EN RY  | VY EY RY    | VY EN RY    |
| bob     | VY EY RY   | VY EY RY   | VN EN RN   | VN EN RN  | VN EN RN | VY EN RY   | VY EY RY    | VN EN RN | VY EN RY  | VN EN RN    | VN EN RN | VN EN RN  | VN EN RN  | VY EN RY    | VY EN RY    |
| charlie | VY EN RY   | VY EN RY   | VN EN RN   | VN EN RN  | VN EN RN | VY EN RY   | VN EN RN    | VN EN RN | VY EN RY  | VN EN RN    | VN EN RN | VN EN RN  | VN EN RN  | VY EN RY    | VY EN RY    |
| oscar   | VY EN RY   | VY EN RY   | VN EN RN   | VN EN RN  | VN EN RN | VY EN RY   | VN EN RN    | VN EN RN | VY EN RY  | VN EN RN    | VN EN RN | VN EN RN  | VN EN RN  | VY EN RY    | VY EY RY    |
| diana   | VN EN RN   | VN EN RN   | VN EN RN   | VY EY RY  | VY EY RY | VY EN RY   | VY EY RY    | VN EN RN | VN EN RN  | VY EN RY    | VN EN RN | VN EN RN  | VY EN RY  | VY EY RY    | VN EN RN    |
| eve     | VN EN RN   | VN EN RN   | VN EN RN   | VY EN RY  | VY EY RY | VY EN RY   | VN EN RN    | VY EY RY | VN EN RN  | VY EN RY    | VN EN RN | VN EN RN  | VN EN RN  | VY EN RY    | VN EN RN    |
| frank   | VN EN RN   | VN EN RN   | VN EN RN   | VY EN RY  | VY EN RY | VY EN RY   | VY EN RY    | VN EN RN | VN EN RN  | VY EN RY    | VN EN RN | VN EN RN  | VN EN RN  | VY EN RY    | VN EN RN    |
| grace   | VN EN RN   | VN EN RN   | VN EN RN   | VY EN RY  | VN EN RN | VY EN RY   | VN EN RN    | VN EN RN | VY EY RY  | VY EN RY    | VN EN RN | VN EN RN  | VN EN RN  | VY EY RY    | VN EN RN    |
| henry   | VN EN RN   | VN EN RN   | VN EN RN   | VY EN RY  | VN EN RN | VY EN RY   | VN EN RN    | VN EN RN | VY EY RY  | VY EY RY    | VN EN RN | VN EN RN  | VN EN RN  | VY EN RY    | VN EN RN    |
| irene   | VN EN RN   | VN EN RN   | VN EN RN   | VN EN RN  | VN EN RN | VY EN RY   | VN EN RN    | VN EN RN | VN EN RN  | VN EN RN    | VY EY RY | VN EN RN  | VY EY RY  | VN EN RN    | VN EN RN    |
| jack    | VN EN RN   | VN EN RN   | VN EN RN   | VN EN RN  | VN EN RN | VY EN RY   | VN EN RN    | VN EN RN | VN EN RN  | VN EN RN    | VY EY RY | VY EY RY  | VN EN RN  | VN EN RN    | VN EN RN    |

## Test Commands

```bash
source .env

# Owner access
ory is allowed alice view Document api-design-doc --project $ORY_PROJECT --workspace $ORY_WORKSPACE

# Editor access
ory is allowed bob edit Document api-design-doc --project $ORY_PROJECT --workspace $ORY_WORKSPACE

# Team viewer access
ory is allowed charlie view Document api-design-doc --project $ORY_PROJECT --workspace $ORY_WORKSPACE

# Cross-team document visible to all teams
ory is allowed irene view Document cross-team-roadmap --project $ORY_PROJECT --workspace $ORY_WORKSPACE

# RAG inclusion follows view permissions
ory is allowed alice include_in_rag Document budget-forecast --project $ORY_PROJECT --workspace $ORY_WORKSPACE
ory is allowed bob include_in_rag Document budget-forecast --project $ORY_PROJECT --workspace $ORY_WORKSPACE  # Denied

# Private documents are invisible to others
ory is allowed frank view Document alice-private-notes --project $ORY_PROJECT --workspace $ORY_WORKSPACE  # Denied

# Design team can see engineering docs via cross-team sharing
ory is allowed grace view Document brand-guidelines --project $ORY_PROJECT --workspace $ORY_WORKSPACE
ory is allowed grace view Document deployment-runbook --project $ORY_PROJECT --workspace $ORY_WORKSPACE  # Denied
```
