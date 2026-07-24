/**
 * Keto API client — calls the Ory Permissions API through the typed
 * @ory/client-fetch SDK, via the Vite dev proxy.
 *
 * Proxy route: /api/* -> ory tunnel (localhost:4000) -> Ory Network
 * The Vite proxy injects the Authorization header server-side so the
 * PAT never reaches the browser; the SDK only knows the /api base path.
 */
import {
  Configuration,
  PermissionApi,
  RelationshipApi,
  ResponseError,
} from "@ory/client-fetch";
import type { Relationship, SubjectSet } from "@ory/client-fetch";

const configuration = new Configuration({ basePath: "/api" });
const relationshipApi = new RelationshipApi(configuration);
const permissionApi = new PermissionApi(configuration);

/**
 * An entity that appears as the subject of tuples. The recommended form is a
 * namespaced subject set with an empty relation ("User:alice"); bare
 * subject_id strings are deprecated but still supported for legacy data.
 */
export interface SubjectRef {
  /** Display label and canonical key: "User:alice" for subject sets, the raw ID for legacy subject_ids. */
  label: string;
  subject_id?: string;
  subject_set?: SubjectSet;
}

/**
 * The entity SubjectRef of a tuple's subject, or null when the subject is a
 * pointer to another relation (subject set with a non-empty relation).
 */
export function subjectRefOf(t: Relationship): SubjectRef | null {
  if (t.subject_id) {
    return { label: t.subject_id, subject_id: t.subject_id };
  }
  if (t.subject_set && !t.subject_set.relation) {
    return {
      label: `${t.subject_set.namespace}:${t.subject_set.object}`,
      subject_set: t.subject_set,
    };
  }
  return null;
}

/** Whether the tuple's subject is the given entity. */
export function subjectMatches(t: Relationship, ref: SubjectRef): boolean {
  if (ref.subject_id) return t.subject_id === ref.subject_id;
  const ss = ref.subject_set;
  return (
    !!ss &&
    !!t.subject_set &&
    t.subject_set.namespace === ss.namespace &&
    t.subject_set.object === ss.object &&
    !t.subject_set.relation
  );
}

/** A single permission to verify for a subject. */
export interface PermissionCheck {
  namespace: string;
  object: string;
  permission: string;
  subject: SubjectRef;
}

/** The verdict for one PermissionCheck. */
export interface PermissionResult extends PermissionCheck {
  allowed: boolean;
}

/** Fetch the list of namespaces from the current OPL deployment. */
export async function fetchNamespaces(): Promise<string[]> {
  const { namespaces } = await relationshipApi.listRelationshipNamespaces();
  return (namespaces ?? []).flatMap((n) => (n.name ? [n.name] : []));
}

/**
 * Fetch all relation tuples for a given namespace, handling pagination.
 * Returns a flat array of tuple objects.
 */
async function fetchTuplesForNamespace(
  namespace: string,
): Promise<Relationship[]> {
  const tuples: Relationship[] = [];
  let pageToken: string | undefined;

  do {
    const page = await relationshipApi.getRelationships({
      namespace,
      pageSize: 250,
      pageToken,
    });
    tuples.push(...(page.relation_tuples ?? []));
    pageToken = page.next_page_token || undefined;
  } while (pageToken);

  return tuples;
}

/**
 * Fetch ALL relation tuples across all namespaces.
 * Fetches each namespace in parallel.
 */
export async function fetchAllTuples(
  namespaces: string[],
): Promise<Relationship[]> {
  const results = await Promise.all(namespaces.map(fetchTuplesForNamespace));
  return results.flat();
}

/**
 * Check a single permission via POST /relation-tuples/check.
 * Ory answers 200 {allowed: true} when allowed and 403 when denied; the SDK
 * throws a ResponseError for the 403, which we translate back into `false`.
 */
export async function checkPermission(
  request: Pick<Relationship, "namespace" | "object" | "relation"> & {
    subject: SubjectRef;
  },
): Promise<boolean> {
  try {
    const result = await permissionApi.postCheckPermission({
      postCheckPermissionBody: {
        namespace: request.namespace,
        object: request.object,
        relation: request.relation,
        ...(request.subject.subject_id
          ? { subject_id: request.subject.subject_id }
          : { subject_set: request.subject.subject_set }),
      },
    });
    return result.allowed;
  } catch (err) {
    if (err instanceof ResponseError && err.response.status === 403) {
      return false;
    }
    throw err;
  }
}

/**
 * Check multiple permissions in sequence (Ory doesn't have a batch endpoint
 * on the public check API; doing them individually).
 * Returns an array of { namespace, object, permission, allowed } results.
 */
export async function checkPermissions(
  checks: PermissionCheck[],
): Promise<PermissionResult[]> {
  const results: PermissionResult[] = [];
  // Run in batches of 10 concurrent requests to avoid overwhelming the API
  const BATCH_SIZE = 10;
  for (let i = 0; i < checks.length; i += BATCH_SIZE) {
    const batch = checks.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (c) => ({
        ...c,
        allowed: await checkPermission({
          namespace: c.namespace,
          object: c.object,
          relation: c.permission,
          subject: c.subject,
        }),
      })),
    );
    results.push(...batchResults);
  }
  return results;
}

/**
 * Derive the list of entity subjects from tuples: namespaced subject sets
 * with an empty relation ("User:alice") plus legacy subject_ids.
 */
export function deriveSubjects(tuples: Relationship[]): SubjectRef[] {
  const byLabel = new Map<string, SubjectRef>();
  for (const t of tuples) {
    const ref = subjectRefOf(t);
    if (ref && !byLabel.has(ref.label)) {
      byLabel.set(ref.label, ref);
    }
  }
  return Array.from(byLabel.values()).sort((a, b) => a.label.localeCompare(b.label));
}
