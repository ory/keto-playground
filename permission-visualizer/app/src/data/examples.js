/**
 * Example metadata — use case names, descriptions, permission definitions,
 * and namespace colors. Tuples and users are fetched live from Keto.
 */
const EXAMPLES = {
  "rbac-app-access": {
    name: "RBAC App Access",
    description:
      "Role-Based Access Control for Applications — users assigned to roles, roles grant access to apps",
    permissions: [{ namespace: "Application", permissions: ["access"] }],
    namespaceColors: {
      User: "#6366f1",
      Role: "#f59e0b",
      Application: "#10b981",
    },
  },

  "rbac-bank-accounts": {
    name: "RBAC Bank Accounts",
    description:
      "Role-Based Permissions on Bank Accounts with family members (owners, spouses, children) and bank staff roles",
    permissions: [
      {
        namespace: "BankAccount",
        permissions: ["view", "transfer", "limited_transfer", "admin"],
      },
    ],
    namespaceColors: {
      User: "#6366f1",
      Role: "#f59e0b",
      BankAccount: "#ef4444",
    },
  },

  "rag-document-access": {
    name: "RAG Document Access",
    description:
      "Document Access Control for RAG Pipelines — team and individual grants determine which documents enter a user's RAG context",
    permissions: [
      { namespace: "Document", permissions: ["view", "edit", "include_in_rag"] },
    ],
    namespaceColors: {
      User: "#6366f1",
      Team: "#f59e0b",
      Document: "#06b6d4",
    },
  },

  "b2b-hierarchy": {
    name: "B2B Hierarchy",
    description:
      "B2B Hierarchical Permission Inheritance — Business > Line of Business > Customer with permissions flowing downward",
    permissions: [
      { namespace: "LineOfBusiness", permissions: ["view", "manage"] },
      { namespace: "Customer", permissions: ["view", "manage"] },
    ],
    namespaceColors: {
      User: "#6366f1",
      Business: "#dc2626",
      LineOfBusiness: "#f59e0b",
      Customer: "#10b981",
    },
  },

  "saas-feature-gating": {
    name: "SaaS Feature Gating",
    description:
      "Multi-Tenant SaaS with subscription-based feature access — organizations subscribe to plans that unlock features",
    permissions: [{ namespace: "Feature", permissions: ["use"] }],
    namespaceColors: {
      User: "#6366f1",
      Organization: "#8b5cf6",
      Plan: "#f59e0b",
      Feature: "#10b981",
    },
  },

  "healthcare-records": {
    name: "Healthcare Records",
    description:
      "Patient Record Access with care teams, consent-based viewing, and emergency break-the-glass access",
    permissions: [
      { namespace: "Patient", permissions: ["view_records", "edit_records"] },
      { namespace: "MedicalRecord", permissions: ["view", "edit"] },
    ],
    namespaceColors: {
      User: "#6366f1",
      Patient: "#ec4899",
      MedicalRecord: "#ef4444",
    },
  },

  "content-publishing-workflow": {
    name: "Content Publishing Workflow",
    description:
      "Editorial Workflow with stage-based permissions — articles move through Draft, Review, and Published stages with role-gated actions",
    permissions: [
      { namespace: "Article", permissions: ["view", "edit", "approve", "publish"] },
    ],
    namespaceColors: {
      User: "#6366f1",
      Role: "#f59e0b",
      Article: "#06b6d4",
    },
  },
};

export default EXAMPLES;
