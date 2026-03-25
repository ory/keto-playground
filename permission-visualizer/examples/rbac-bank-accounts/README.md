# RBAC Bank Accounts

Role-Based Permissions on Bank Accounts with Family Members. Bank staff have role-based access. Account owners, spouses, and children have direct access with different permission levels.

## Permission Model

```
User ──member──▶ Role ──viewers_role/transferors_role/admins──▶ BankAccount
User ──owners/spouses/children──▶ BankAccount
```

### Permissions

- `view`: owner OR spouse OR child OR viewer role member OR admin role member
- `transfer`: owner OR spouse OR transferor role member OR admin role member (children CANNOT transfer)
- `limited_transfer`: child OR owner OR spouse OR transferor role member OR admin role member (for small amounts — enforcement in app layer)
- `admin`: owner OR admin role member only

### Bank Staff (12 users, 5 roles)

- **teller**: sarah, tom, rachel — view checking/savings/joint-savings only
- **account_manager**: maria, james, linda — view + transfer on checking, business, credit-line, escrow, joint-savings
- **branch_admin**: patricia, robert — full admin on all accounts
- **auditor**: nancy, kevin — view-only across all accounts
- **loan_officer**: diana, steve — view + transfer on mortgage and credit-line

### Account Holders (3 families)

**Smith Family:**
- john-smith (owner): checking-1001, savings-2001, mortgage-5001, college-fund-9001
- jane-smith (spouse): checking-1001, savings-2001, mortgage-5001
- timmy-smith (child): checking-1001, college-fund-9001
- emma-smith (child): checking-1001

**Garcia Family:**
- carlos-garcia (owner): business-3001, credit-line-6001, escrow-8001
- maria-garcia (spouse): business-3001, escrow-8001
- luis-garcia (child): business-3001

**Wong Family:**
- patricia-wong (owner): vault-4001, trust-7001, joint-savings-10001
- david-wong (spouse): trust-7001, joint-savings-10001
- lily-wong (child): trust-7001, joint-savings-10001
- max-wong (child): trust-7001

### Accounts (10)

| Account              | Owner          | Spouse       | Children              |
|----------------------|----------------|--------------|-----------------------|
| checking-1001        | john-smith     | jane-smith   | timmy-smith, emma-smith|
| savings-2001         | john-smith     | jane-smith   | —                     |
| business-3001        | carlos-garcia  | maria-garcia | luis-garcia            |
| vault-4001           | patricia-wong  | —            | —                     |
| mortgage-5001        | john-smith     | jane-smith   | —                     |
| credit-line-6001     | carlos-garcia  | —            | —                     |
| trust-7001           | patricia-wong  | david-wong   | lily-wong, max-wong   |
| escrow-8001          | carlos-garcia  | maria-garcia | —                     |
| college-fund-9001    | john-smith     | —            | timmy-smith           |
| joint-savings-10001  | patricia-wong  | david-wong   | lily-wong             |

## Exhaustive Expected Permissions (920 checks — all verified)

Format: V=view, T=transfer, L=limited_transfer, A=admin. Y=Allowed, N=Denied.

### Family Members

| User           | checking-1001  | savings-2001   | business-3001  | vault-4001     | mortgage-5001  | credit-line-6001| trust-7001     | escrow-8001    | college-fund-9001| joint-savings-10001|
|----------------|----------------|----------------|----------------|----------------|----------------|-----------------|----------------|----------------|------------------|--------------------|
| john-smith     | VY TY LY AY    | VY TY LY AY    | VN TN LN AN    | VN TN LN AN    | VY TY LY AY    | VN TN LN AN     | VN TN LN AN    | VN TN LN AN    | VY TY LY AY      | VN TN LN AN        |
| jane-smith     | VY TY LY AN    | VY TY LY AN    | VN TN LN AN    | VN TN LN AN    | VY TY LY AN    | VN TN LN AN     | VN TN LN AN    | VN TN LN AN    | VN TN LN AN      | VN TN LN AN        |
| timmy-smith    | VY TN LY AN    | VN TN LN AN    | VN TN LN AN    | VN TN LN AN    | VN TN LN AN    | VN TN LN AN     | VN TN LN AN    | VN TN LN AN    | VY TN LY AN      | VN TN LN AN        |
| emma-smith     | VY TN LY AN    | VN TN LN AN    | VN TN LN AN    | VN TN LN AN    | VN TN LN AN    | VN TN LN AN     | VN TN LN AN    | VN TN LN AN    | VN TN LN AN      | VN TN LN AN        |
| carlos-garcia  | VN TN LN AN    | VN TN LN AN    | VY TY LY AY    | VN TN LN AN    | VN TN LN AN    | VY TY LY AY     | VN TN LN AN    | VY TY LY AY    | VN TN LN AN      | VN TN LN AN        |
| maria-garcia   | VN TN LN AN    | VN TN LN AN    | VY TY LY AN    | VN TN LN AN    | VN TN LN AN    | VN TN LN AN     | VN TN LN AN    | VY TY LY AN    | VN TN LN AN      | VN TN LN AN        |
| luis-garcia    | VN TN LN AN    | VN TN LN AN    | VY TN LY AN    | VN TN LN AN    | VN TN LN AN    | VN TN LN AN     | VN TN LN AN    | VN TN LN AN    | VN TN LN AN      | VN TN LN AN        |
| patricia-wong  | VN TN LN AN    | VN TN LN AN    | VN TN LN AN    | VY TY LY AY    | VN TN LN AN    | VN TN LN AN     | VY TY LY AY    | VN TN LN AN    | VN TN LN AN      | VY TY LY AY        |
| david-wong     | VN TN LN AN    | VN TN LN AN    | VN TN LN AN    | VN TN LN AN    | VN TN LN AN    | VN TN LN AN     | VY TY LY AN    | VN TN LN AN    | VN TN LN AN      | VY TY LY AN        |
| lily-wong      | VN TN LN AN    | VN TN LN AN    | VN TN LN AN    | VN TN LN AN    | VN TN LN AN    | VN TN LN AN     | VY TN LY AN    | VN TN LN AN    | VN TN LN AN      | VY TN LY AN        |
| max-wong       | VN TN LN AN    | VN TN LN AN    | VN TN LN AN    | VN TN LN AN    | VN TN LN AN    | VN TN LN AN     | VY TN LY AN    | VN TN LN AN    | VN TN LN AN      | VN TN LN AN        |

### Bank Staff (all 10 accounts)

| User     | checking | savings | business | vault  | mortgage | credit-line | trust  | escrow | college-fund | joint-savings |
|----------|----------|---------|----------|--------|----------|-------------|--------|--------|--------------|---------------|
| sarah    | VY TN    | VY TN   | VN TN    | VN TN  | VN TN    | VN TN       | VN TN  | VN TN  | VN TN        | VY TN         |
| tom      | VY TN    | VY TN   | VN TN    | VN TN  | VN TN    | VN TN       | VN TN  | VN TN  | VN TN        | VY TN         |
| rachel   | VY TN    | VY TN   | VN TN    | VN TN  | VN TN    | VN TN       | VN TN  | VN TN  | VN TN        | VY TN         |
| maria    | VY TY    | VN TY   | VY TY    | VN TN  | VN TN    | VY TN       | VN TN  | VY TY  | VN TN        | VN TY         |
| james    | VY TY    | VN TY   | VY TY    | VN TN  | VN TN    | VY TN       | VN TN  | VY TY  | VN TN        | VN TY         |
| linda    | VY TY    | VN TY   | VY TY    | VN TN  | VN TN    | VY TN       | VN TN  | VY TY  | VN TN        | VN TY         |
| patricia | VY TY AY | VY TY AY| VY TY AY | VY TY AY| VY TY AY | VY TY AY   | VY TY AY| VY TY AY| VY TY AY    | VY TY AY      |
| robert   | VY TY AY | VY TY AY| VY TY AY | VY TY AY| VY TY AY | VY TY AY   | VY TY AY| VY TY AY| VY TY AY    | VY TY AY      |
| nancy    | VY TN    | VY TN   | VY TN    | VY TN  | VY TN    | VY TN       | VY TN  | VY TN  | VY TN        | VY TN         |
| kevin    | VY TN    | VY TN   | VY TN    | VY TN  | VY TN    | VY TN       | VY TN  | VY TN  | VY TN        | VY TN         |
| diana    | VN TN    | VN TN   | VN TN    | VN TN  | VY TY    | VY TY       | VN TN  | VN TN  | VN TN        | VN TN         |
| steve    | VN TN    | VN TN   | VN TN    | VN TN  | VY TY    | VY TY       | VN TN  | VN TN  | VN TN        | VN TN         |

Note: For staff, L (limited_transfer) matches T (transfer) exactly. A (admin) is N for all except branch_admin.

## Test Commands

```bash
source .env

# Owner: full access
ory is allowed john-smith admin BankAccount checking-1001 --project $ORY_PROJECT --workspace $ORY_WORKSPACE

# Spouse: view + transfer, no admin
ory is allowed jane-smith transfer BankAccount checking-1001 --project $ORY_PROJECT --workspace $ORY_WORKSPACE
ory is allowed jane-smith admin BankAccount checking-1001 --project $ORY_PROJECT --workspace $ORY_WORKSPACE  # Denied

# Child: view + limited_transfer only, no full transfer
ory is allowed timmy-smith view BankAccount checking-1001 --project $ORY_PROJECT --workspace $ORY_WORKSPACE
ory is allowed timmy-smith limited_transfer BankAccount checking-1001 --project $ORY_PROJECT --workspace $ORY_WORKSPACE
ory is allowed timmy-smith transfer BankAccount checking-1001 --project $ORY_PROJECT --workspace $ORY_WORKSPACE  # Denied

# Cross-family isolation
ory is allowed jane-smith view BankAccount business-3001 --project $ORY_PROJECT --workspace $ORY_WORKSPACE  # Denied
ory is allowed lily-wong view BankAccount checking-1001 --project $ORY_PROJECT --workspace $ORY_WORKSPACE  # Denied

# Branch admin: full access everywhere
ory is allowed patricia admin BankAccount vault-4001 --project $ORY_PROJECT --workspace $ORY_WORKSPACE

# Auditor: view-only
ory is allowed nancy view BankAccount trust-7001 --project $ORY_PROJECT --workspace $ORY_WORKSPACE
ory is allowed nancy transfer BankAccount trust-7001 --project $ORY_PROJECT --workspace $ORY_WORKSPACE  # Denied
```
