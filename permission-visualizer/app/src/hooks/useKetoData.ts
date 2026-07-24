import { useState, useEffect, useCallback, useRef } from "react";
import type { Relationship } from "@ory/client-fetch";

import {
  fetchNamespaces,
  fetchAllTuples,
  checkPermissions,
  deriveSubjects,
} from "../api/ketoClient";
import type {
  PermissionCheck,
  PermissionResult,
  SubjectRef,
} from "../api/ketoClient";
import type { ExampleMeta } from "../data/examples";

/** The common shape returned by both the live and the offline data hook. */
export interface KetoData {
  tuples: Relationship[];
  subjects: SubjectRef[];
  namespaces: string[];
  loading: boolean;
  error: string | null;
  permissionResults: PermissionResult[];
  loadingPermissions: boolean;
  checkSubjectPermissions: (subject: SubjectRef) => void;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * React hook that fetches live Keto data (namespaces, tuples, permission checks).
 *
 * @param exampleMeta - The selected example metadata (permissions, etc.)
 */
export function useKetoData(exampleMeta: ExampleMeta | null): KetoData {
  const [tuples, setTuples] = useState<Relationship[]>([]);
  const [subjects, setSubjects] = useState<SubjectRef[]>([]);
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissionResults, setPermissionResults] = useState<PermissionResult[]>([]);
  const [loadingPermissions, setLoadingPermissions] = useState(false);
  const abortRef = useRef<{ cancelled: boolean } | null>(null);

  // Fetch namespaces + tuples when example changes
  useEffect(() => {
    if (!exampleMeta) {
      setTuples([]);
      setSubjects([]);
      setNamespaces([]);
      setError(null);
      setPermissionResults([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setPermissionResults([]);

    (async () => {
      try {
        const ns = await fetchNamespaces();
        if (cancelled) return;
        setNamespaces(ns);

        const allTuples = await fetchAllTuples(ns);
        if (cancelled) return;
        setTuples(allTuples);
        setSubjects(deriveSubjects(allTuples));
      } catch (err) {
        if (!cancelled) setError(errorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [exampleMeta]);

  // Check permissions for a specific subject
  const checkSubjectPermissions = useCallback(
    async (subject: SubjectRef) => {
      if (!exampleMeta || tuples.length === 0) {
        setPermissionResults([]);
        return;
      }

      // Cancel any in-flight check
      if (abortRef.current) abortRef.current.cancelled = true;
      const thisCheck = { cancelled: false };
      abortRef.current = thisCheck;

      setLoadingPermissions(true);

      try {
        // Build the check matrix: for each permission def, for each unique object
        // in that namespace, for each permission name
        const checks: PermissionCheck[] = [];
        for (const permDef of exampleMeta.permissions) {
          const objects = new Set<string>();
          for (const t of tuples) {
            if (t.namespace === permDef.namespace) {
              objects.add(t.object);
            }
          }
          for (const obj of objects) {
            for (const perm of permDef.permissions) {
              checks.push({
                namespace: permDef.namespace,
                object: obj,
                permission: perm,
                subject,
              });
            }
          }
        }

        const results = await checkPermissions(checks);
        if (!thisCheck.cancelled) {
          setPermissionResults(results);
        }
      } catch (err) {
        if (!thisCheck.cancelled) {
          setError(errorMessage(err));
        }
      } finally {
        if (!thisCheck.cancelled) {
          setLoadingPermissions(false);
        }
      }
    },
    [exampleMeta, tuples],
  );

  return {
    tuples,
    subjects,
    namespaces,
    loading,
    error,
    permissionResults,
    loadingPermissions,
    checkSubjectPermissions,
  };
}
