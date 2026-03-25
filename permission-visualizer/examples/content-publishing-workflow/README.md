# Content Publishing Workflow

Editorial Workflow with Stage-Based Permissions. Articles move through stages: Draft → Review → Published. Different roles have permissions at different stages. Stage transitions are modeled by adding/removing relation tuples.

## Permission Model

```
Draft:     author ──draft_editors──▶ Article (edit)
Review:    editor ──review_editors──▶ Article (edit, approve)
           publisher ──review_publishers──▶ Article (publish)
Published: reader/writer/editor/publisher ──published_viewers──▶ Article (view)
Always:    author + assigned_editor can view their articles
```

### Permission Logic

- `view`: author OR assigned_editor OR member of a published_viewers role
- `edit`: in draft_editors (author during draft) OR in review_editors (editor during review)
- `approve`: in review_editors (assigned editor during review only)
- `publish`: member of review_publishers role (publishers during review only)

### Stage Transitions

When an article moves between stages, the application updates relation tuples:
1. **Created (draft)**: add author to `draft_editors`
2. **Submitted for review**: remove `draft_editors`, add assigned editor to `review_editors`, add publisher role to `review_publishers`
3. **Published**: remove `review_editors` and `review_publishers`, add reader/all roles to `published_viewers`

### Roles & Users (10)

- **writer**: writer-alice, writer-bob, writer-charlie
- **editor**: editor-diana, editor-eve
- **publisher**: publisher-frank, publisher-grace
- **reader**: reader-henry, reader-irene, reader-jack

### Articles (7)

| Article          | Stage     | Author         | Assigned Editor | Notes                      |
|------------------|-----------|----------------|-----------------|----------------------------|
| art-draft-1      | Draft     | writer-alice   | editor-diana    | Alice can edit              |
| art-draft-2      | Draft     | writer-bob     | editor-eve      | Bob can edit                |
| art-draft-3      | Draft     | writer-charlie | editor-diana    | Charlie can edit            |
| art-review-1     | Review    | writer-alice   | editor-diana    | Diana can edit/approve, publishers can publish |
| art-review-2     | Review    | writer-bob     | editor-eve      | Eve can edit/approve, publishers can publish |
| art-published-1  | Published | writer-alice   | editor-diana    | Everyone can view           |
| art-published-2  | Published | writer-charlie | editor-eve      | Everyone can view           |

## Exhaustive Expected Permissions (280 checks — all verified)

Format: V=view, E=edit, A=approve, P=publish. Y=Allowed, N=Denied.

| User             | draft-1      | draft-2      | draft-3      | review-1     | review-2     | published-1  | published-2  |
|------------------|--------------|--------------|--------------|--------------|--------------|--------------|--------------|
| writer-alice     | VY EY AN PN  | VN EN AN PN  | VN EN AN PN  | VY EN AN PN  | VN EN AN PN  | VY EN AN PN  | VY EN AN PN  |
| writer-bob       | VN EN AN PN  | VY EY AN PN  | VN EN AN PN  | VN EN AN PN  | VY EN AN PN  | VY EN AN PN  | VY EN AN PN  |
| writer-charlie   | VN EN AN PN  | VN EN AN PN  | VY EY AN PN  | VN EN AN PN  | VN EN AN PN  | VY EN AN PN  | VY EN AN PN  |
| editor-diana     | VY EN AN PN  | VN EN AN PN  | VY EN AN PN  | VY EY AY PN  | VN EN AN PN  | VY EN AN PN  | VY EN AN PN  |
| editor-eve       | VN EN AN PN  | VY EN AN PN  | VN EN AN PN  | VN EN AN PN  | VY EY AY PN  | VY EN AN PN  | VY EN AN PN  |
| publisher-frank  | VN EN AN PN  | VN EN AN PN  | VN EN AN PN  | VN EN AN PY  | VN EN AN PY  | VY EN AN PN  | VY EN AN PN  |
| publisher-grace  | VN EN AN PN  | VN EN AN PN  | VN EN AN PN  | VN EN AN PY  | VN EN AN PY  | VY EN AN PN  | VY EN AN PN  |
| reader-henry     | VN EN AN PN  | VN EN AN PN  | VN EN AN PN  | VN EN AN PN  | VN EN AN PN  | VY EN AN PN  | VY EN AN PN  |
| reader-irene     | VN EN AN PN  | VN EN AN PN  | VN EN AN PN  | VN EN AN PN  | VN EN AN PN  | VY EN AN PN  | VY EN AN PN  |
| reader-jack      | VN EN AN PN  | VN EN AN PN  | VN EN AN PN  | VN EN AN PN  | VN EN AN PN  | VY EN AN PN  | VY EN AN PN  |

## Test Commands

```bash
source .env

# Writer can edit own draft
ory is allowed writer-alice edit Article art-draft-1 --project $ORY_PROJECT --workspace $ORY_WORKSPACE
ory is allowed writer-bob edit Article art-draft-1 --project $ORY_PROJECT --workspace $ORY_WORKSPACE  # Denied

# Editor can edit/approve in review
ory is allowed editor-diana edit Article art-review-1 --project $ORY_PROJECT --workspace $ORY_WORKSPACE
ory is allowed editor-diana approve Article art-review-1 --project $ORY_PROJECT --workspace $ORY_WORKSPACE
ory is allowed editor-eve approve Article art-review-1 --project $ORY_PROJECT --workspace $ORY_WORKSPACE  # Denied (not assigned)

# Publisher can publish reviewed articles
ory is allowed publisher-frank publish Article art-review-1 --project $ORY_PROJECT --workspace $ORY_WORKSPACE
ory is allowed publisher-frank publish Article art-draft-1 --project $ORY_PROJECT --workspace $ORY_WORKSPACE  # Denied

# Readers can only view published
ory is allowed reader-henry view Article art-published-1 --project $ORY_PROJECT --workspace $ORY_WORKSPACE
ory is allowed reader-henry view Article art-draft-1 --project $ORY_PROJECT --workspace $ORY_WORKSPACE  # Denied

# No one can edit published
ory is allowed writer-alice edit Article art-published-1 --project $ORY_PROJECT --workspace $ORY_WORKSPACE  # Denied
```
