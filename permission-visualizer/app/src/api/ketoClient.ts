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
 * A subject of tuples. The recommended form is a namespaced subject set with an
 * empty relation ("User:alice"); a subject set with a relation
 * ("Group:eng#members") stands for everyone holding that relation; bare
 * subject_id strings are deprecated but still supported for legacy data.
 */
export interface SubjectRef {
  /** Display label and canonical key: "User:alice", "Group:eng#members", or the raw legacy subject_id. */
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

/** Whether the tuple's subject is exactly the given subject (including its relation). */
export function subjectMatches(t: Relationship, ref: SubjectRef): boolean {
  if (ref.subject_id) return t.subject_id === ref.subject_id;
  const ss = ref.subject_set;
  return (
    !!ss &&
    !!t.subject_set &&
    t.subject_set.namespace === ss.namespace &&
    t.subject_set.object === ss.object &&
    (t.subject_set.relation || "") === (ss.relation || "")
  );
}

/** Synthetic group under which legacy subject_ids are listed: they carry no namespace. */
export const DIRECT_ID_NAMESPACE = "Direct ID";

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
 * Derive every distinct subject from tuples: entity subject sets ("User:alice"),
 * subject sets with a relation ("Group:eng#members") and legacy subject_ids.
 */
export function deriveSubjects(tuples: Relationship[]): SubjectRef[] {
  const byLabel = new Map<string, SubjectRef>();
  for (const t of tuples) {
    const ref =
      subjectRefOf(t) ??
      (t.subject_set?.namespace && t.subject_set.object
        ? {
            label: `${t.subject_set.namespace}:${t.subject_set.object}#${t.subject_set.relation}`,
            subject_set: t.subject_set,
          }
        : null);
    if (ref && !byLabel.has(ref.label)) {
      byLabel.set(ref.label, ref);
    }
  }
  return Array.from(byLabel.values()).sort((a, b) => a.label.localeCompare(b.label));
}

/** Subjects grouped for the picker: by subject-set namespace, legacy IDs under DIRECT_ID_NAMESPACE. */
export function groupSubjectsByNamespace(subjects: SubjectRef[]): Map<string, SubjectRef[]> {
  const groups = new Map<string, SubjectRef[]>();
  for (const s of subjects) {
    const ns = s.subject_set?.namespace ?? DIRECT_ID_NAMESPACE;
    groups.set(ns, [...(groups.get(ns) ?? []), s]);
  }
  return new Map([...groups].sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Delete one relation tuple by exact match (Keto admin API, proxied with the
 * project API key; the key needs write access).
 */
export async function deleteRelationTuple(tuple: Relationship): Promise<void> {
  // Every filter of the delete endpoint is optional: a missing field would widen the
  // delete to many tuples, so require a fully specified tuple.
  const hasSubject = tuple.subject_id || (tuple.subject_set?.namespace && tuple.subject_set.object);
  if (!tuple.namespace || !tuple.object || !tuple.relation || !hasSubject) {
    throw new Error("Refusing to delete an incompletely specified relation tuple");
  }
  await relationshipApi.deleteRelationships({
    namespace: tuple.namespace,
    object: tuple.object,
    relation: tuple.relation,
    ...(tuple.subject_id
      ? { subjectId: tuple.subject_id }
      : {
          subjectSetNamespace: tuple.subject_set?.namespace,
          subjectSetObject: tuple.subject_set?.object,
          subjectSetRelation: tuple.subject_set?.relation ?? "",
        }),
  });
}

/** Delete tuples in small concurrent batches; failures are collected, not thrown. */
export async function deleteRelationTuples(
  tuples: Relationship[],
): Promise<{ deleted: number; errors: { tuple: Relationship; reason: string }[] }> {
  const errors: { tuple: Relationship; reason: string }[] = [];
  let deleted = 0;
  const BATCH_SIZE = 5;
  for (let i = 0; i < tuples.length; i += BATCH_SIZE) {
    const batch = tuples.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(deleteRelationTuple));
    results.forEach((r, j) => {
      if (r.status === "fulfilled") deleted++;
      else errors.push({ tuple: batch[j], reason: r.reason instanceof Error ? r.reason.message : String(r.reason) });
    });
  }
  return { deleted, errors };
}
