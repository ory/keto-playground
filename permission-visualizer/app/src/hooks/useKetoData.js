import { useState, useEffect, useCallback, useRef } from "react";
import {
  fetchNamespaces,
  fetchAllTuples,
  checkPermissions,
  deriveSubjects,
} from "../api/ketoClient";

/**
 * React hook that fetches live Keto data (namespaces, tuples, permission checks).
 *
 * @param {object|null} exampleMeta - The selected example metadata (permissions, etc.)
 * @returns {{ tuples, subjects, namespaces, loading, error, permissionResults, loadingPermissions, checkUserPermissions }}
 */
export function useKetoData(exampleMeta) {
  const [tuples, setTuples] = useState([]);
  const [subjects, setSubjects] = useState({});
  const [namespaces, setNamespaces] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [permissionResults, setPermissionResults] = useState([]);
  const [loadingPermissions, setLoadingPermissions] = useState(false);
  const abortRef = useRef(null);

  // Refetch namespaces + tuples (used both on mount/example change and after writes).
  const refetch = useCallback(async () => {
    if (!exampleMeta) {
      setTuples([]);
      setSubjects({});
      setNamespaces([]);
      setError(null);
      setPermissionResults([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const ns = await fetchNamespaces();
      setNamespaces(ns);
      const allTuples = await fetchAllTuples(ns);
      setTuples(allTuples);
      setSubjects(deriveSubjects(allTuples));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [exampleMeta]);

  // Fetch on example change.
  useEffect(() => {
    if (!exampleMeta) {
      setTuples([]);
      setSubjects({});
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
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [exampleMeta]);

  // Check permissions for a specific subject (direct id or subject set).
  const checkUserPermissions = useCallback(
    async (subject) => {
      if (!exampleMeta || !subject || tuples.length === 0) {
        setPermissionResults([]);
        return;
      }

      // Cancel any in-flight check
      if (abortRef.current) abortRef.current.cancelled = true;
      const thisCheck = { cancelled: false };
      abortRef.current = thisCheck;

      setLoadingPermissions(true);

      try {
        const subjectFields =
          subject.kind === "set"
            ? {
                subject_set: {
                  namespace: subject.namespace,
                  object: subject.object,
                  relation: subject.relation,
                },
              }
            : { subject_id: subject.id };

        // Build the check matrix: for each permission def, for each unique object
        // in that namespace, for each permission name
        const checks = [];
        for (const permDef of exampleMeta.permissions) {
          const objects = new Set();
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
                ...subjectFields,
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
          setError(err.message);
        }
      } finally {
        if (!thisCheck.cancelled) {
          setLoadingPermissions(false);
        }
      }
    },
    [exampleMeta, tuples]
  );

  return {
    tuples,
    subjects,
    namespaces,
    loading,
    error,
    permissionResults,
    loadingPermissions,
    checkUserPermissions,
    refetch,
  };
}
