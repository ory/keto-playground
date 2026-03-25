# B2B Hierarchical Permission Inheritance

Two Businesses (acme-corp, globex-inc) each with Lines of Business (LOBs) and Customers. Permissions granted at higher levels inherit downward. Businesses are fully isolated from each other.

## Permission Model

```
Business ◄──parent── LineOfBusiness ◄──parent_lob── Customer
   │                      │                            │
 admins               managers                  account_managers
 viewers               viewers                      viewers
```

### Permission Logic

**Customer permissions** traverse up the tree:
- `view`: direct viewer OR account_manager OR parent LOB viewer/manager OR parent Business viewer/admin
- `manage`: direct account_manager OR parent LOB manager OR parent Business admin

**LOB permissions** traverse to parent Business:
- `view`: direct viewer/manager OR parent Business viewer/admin
- `manage`: direct manager OR parent Business admin

### Hierarchy

```
acme-corp (Business)
├── retail (LOB) — mgr: lisa, analyst: joe
│   ├── cust-r1 (AM: anna, viewer: dan)
│   ├── cust-r2 (AM: anna)
│   ├── cust-r3 (AM: betty)
│   └── cust-r4 (viewer: dan)
├── wholesale (LOB) — mgr: mike, analyst: kate
│   ├── cust-w1 (AM: ben)
│   ├── cust-w2 (AM: carl)
│   └── cust-w3 (viewer: fay)
├── digital (LOB) — mgr: nina, analyst: paul
│   ├── cust-d1 (AM: elena)
│   ├── cust-d2 (AM: elena)
│   └── cust-d3 (viewer: george)
└── insurance (LOB) — mgr: olivia, analyst: ray
    ├── cust-i1 (AM: hank)
    └── cust-i2 (viewer: ivy)

globex-inc (Business)
├── globex-saas (LOB) — mgr: victor
│   ├── cust-gs1 (AM: xander)
│   └── cust-gs2 (viewer: yara)
└── globex-consulting (LOB) — mgr: uma
    ├── cust-gc1 (AM: zach)
    └── cust-gc2 (viewer: lily)
```

### Users

| User                  | Level           | Scope                       |
|-----------------------|-----------------|-----------------------------|
| ceo-pat               | Acme admin      | All 13 acme customers       |
| coo-quinn             | Acme admin      | All 13 acme customers       |
| auditor-sam           | Acme viewer     | View all acme, manage none  |
| auditor-tina          | Acme viewer     | View all acme, manage none  |
| ceo-rick              | Globex admin    | All 4 globex customers      |
| auditor-wendy         | Globex viewer   | View all globex, manage none|
| mgr-retail-lisa       | LOB manager     | Retail (4 customers)        |
| mgr-wholesale-mike    | LOB manager     | Wholesale (3 customers)     |
| mgr-digital-nina      | LOB manager     | Digital (3 customers)       |
| mgr-insurance-olivia  | LOB manager     | Insurance (2 customers)     |
| mgr-saas-victor       | LOB manager     | Globex SaaS (2 customers)   |
| mgr-consulting-uma    | LOB manager     | Globex Consulting (2 custs) |
| analyst-retail-joe    | LOB viewer      | View retail only            |
| analyst-wholesale-kate| LOB viewer      | View wholesale only         |
| analyst-digital-paul  | LOB viewer      | View digital only           |
| analyst-insurance-ray | LOB viewer      | View insurance only         |
| am-retail-anna        | Customer AM     | cust-r1, cust-r2            |
| am-retail-betty       | Customer AM     | cust-r3                     |
| rep-retail-dan        | Customer viewer | cust-r1, cust-r4 view only  |
| am-wholesale-ben      | Customer AM     | cust-w1                     |
| am-wholesale-carl     | Customer AM     | cust-w2                     |
| rep-wholesale-fay     | Customer viewer | cust-w3 view only           |
| am-digital-elena      | Customer AM     | cust-d1, cust-d2            |
| rep-digital-george    | Customer viewer | cust-d3 view only           |
| am-insurance-hank     | Customer AM     | cust-i1                     |
| rep-insurance-ivy     | Customer viewer | cust-i2 view only           |
| am-saas-xander        | Customer AM     | cust-gs1                    |
| rep-saas-yara         | Customer viewer | cust-gs2 view only          |
| am-consulting-zach    | Customer AM     | cust-gc1                    |
| rep-consulting-lily   | Customer viewer | cust-gc2 view only          |

## Exhaustive Expected Permissions (960 checks — all verified)

Format: V=view, M=manage. Y=Allowed, N=Denied. Acme customers: r1-r4, w1-w3, d1-d3, i1-i2. Globex: gs1-gs2, gc1-gc2.

**Business-level users (all 16 customers):**

| User          | r1   | r2   | r3   | r4   | w1   | w2   | w3   | d1   | d2   | d3   | i1   | i2   | gs1  | gs2  | gc1  | gc2  |
|---------------|------|------|------|------|------|------|------|------|------|------|------|------|------|------|------|------|
| ceo-pat       | VY MY| VY MY| VY MY| VY MY| VY MY| VY MY| VY MY| VY MY| VY MY| VY MY| VY MY| VY MY| VN MN| VN MN| VN MN| VN MN|
| coo-quinn     | VY MY| VY MY| VY MY| VY MY| VY MY| VY MY| VY MY| VY MY| VY MY| VY MY| VY MY| VY MY| VN MN| VN MN| VN MN| VN MN|
| auditor-sam   | VY MN| VY MN| VY MN| VY MN| VY MN| VY MN| VY MN| VY MN| VY MN| VY MN| VY MN| VY MN| VN MN| VN MN| VN MN| VN MN|
| auditor-tina  | VY MN| VY MN| VY MN| VY MN| VY MN| VY MN| VY MN| VY MN| VY MN| VY MN| VY MN| VY MN| VN MN| VN MN| VN MN| VN MN|
| ceo-rick      | VN MN| VN MN| VN MN| VN MN| VN MN| VN MN| VN MN| VN MN| VN MN| VN MN| VN MN| VN MN| VY MY| VY MY| VY MY| VY MY|
| auditor-wendy | VN MN| VN MN| VN MN| VN MN| VN MN| VN MN| VN MN| VN MN| VN MN| VN MN| VN MN| VN MN| VY MN| VY MN| VY MN| VY MN|

**LOB-level users (only their LOB customers shown — all others VN MN):**

| User                   | Own LOB customers                                          |
|------------------------|------------------------------------------------------------|
| mgr-retail-lisa        | r1: VY MY, r2: VY MY, r3: VY MY, r4: VY MY               |
| analyst-retail-joe     | r1: VY MN, r2: VY MN, r3: VY MN, r4: VY MN               |
| mgr-wholesale-mike     | w1: VY MY, w2: VY MY, w3: VY MY                           |
| analyst-wholesale-kate | w1: VY MN, w2: VY MN, w3: VY MN                           |
| mgr-digital-nina       | d1: VY MY, d2: VY MY, d3: VY MY                           |
| analyst-digital-paul   | d1: VY MN, d2: VY MN, d3: VY MN                           |
| mgr-insurance-olivia   | i1: VY MY, i2: VY MY                                      |
| analyst-insurance-ray  | i1: VY MN, i2: VY MN                                      |
| mgr-saas-victor        | gs1: VY MY, gs2: VY MY                                    |
| mgr-consulting-uma     | gc1: VY MY, gc2: VY MY                                    |

**Customer-level users (only their assigned customers shown — all others VN MN):**

| User                | Assigned customers                              |
|---------------------|-------------------------------------------------|
| am-retail-anna      | r1: VY MY, r2: VY MY                            |
| am-retail-betty     | r3: VY MY                                       |
| rep-retail-dan      | r1: VY MN, r4: VY MN                            |
| am-wholesale-ben    | w1: VY MY                                       |
| am-wholesale-carl   | w2: VY MY                                       |
| rep-wholesale-fay   | w3: VY MN                                       |
| am-digital-elena    | d1: VY MY, d2: VY MY                            |
| rep-digital-george  | d3: VY MN                                       |
| am-insurance-hank   | i1: VY MY                                       |
| rep-insurance-ivy   | i2: VY MN                                       |
| am-saas-xander      | gs1: VY MY                                      |
| rep-saas-yara       | gs2: VY MN                                      |
| am-consulting-zach  | gc1: VY MY                                      |
| rep-consulting-lily | gc2: VY MN                                      |

## Test Commands

```bash
source .env

# Acme CEO manages all acme customers
ory is allowed ceo-pat manage Customer cust-r1 --project $ORY_PROJECT --workspace $ORY_WORKSPACE
ory is allowed coo-quinn manage Customer cust-i2 --project $ORY_PROJECT --workspace $ORY_WORKSPACE

# Business isolation: Acme admin cannot see Globex
ory is allowed ceo-pat manage Customer cust-gs1 --project $ORY_PROJECT --workspace $ORY_WORKSPACE  # Denied

# Globex CEO manages Globex only
ory is allowed ceo-rick manage Customer cust-gs1 --project $ORY_PROJECT --workspace $ORY_WORKSPACE
ory is allowed ceo-rick manage Customer cust-r1 --project $ORY_PROJECT --workspace $ORY_WORKSPACE  # Denied

# LOB manager: own LOB only
ory is allowed mgr-retail-lisa manage Customer cust-r4 --project $ORY_PROJECT --workspace $ORY_WORKSPACE
ory is allowed mgr-retail-lisa view Customer cust-w1 --project $ORY_PROJECT --workspace $ORY_WORKSPACE  # Denied

# Customer-level AM: only assigned customers
ory is allowed am-retail-anna manage Customer cust-r1 --project $ORY_PROJECT --workspace $ORY_WORKSPACE
ory is allowed am-retail-anna manage Customer cust-r3 --project $ORY_PROJECT --workspace $ORY_WORKSPACE  # Denied

# Auditor: view all acme, manage none
ory is allowed auditor-sam view Customer cust-r1 --project $ORY_PROJECT --workspace $ORY_WORKSPACE
ory is allowed auditor-sam manage Customer cust-r1 --project $ORY_PROJECT --workspace $ORY_WORKSPACE  # Denied
```
