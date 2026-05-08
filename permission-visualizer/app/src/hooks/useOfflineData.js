import { useState, useMemo, useCallback } from "react";
import OFFLINE_EXAMPLES from "../data/offlineExamples";
import { deriveSubjects } from "../api/ketoClient";

/**
 * Hook that provides tuple data from bundled offline examples.
 * Mirrors the useKetoData interface so App.jsx can swap between them.
 */
export function useOfflineData(exampleKey) {
  const [permissionResults] = useState([]);

  const tuples = useMemo(() => {
    if (!exampleKey || !OFFLINE_EXAMPLES[exampleKey]) return [];
    return OFFLINE_EXAMPLES[exampleKey];
  }, [exampleKey]);

  const subjects = useMemo(() => deriveSubjects(tuples), [tuples]);

  const namespaces = useMemo(() => {
    const ns = new Set();
    for (const t of tuples) ns.add(t.namespace);
    return Array.from(ns).sort();
  }, [tuples]);

  const checkUserPermissions = useCallback(() => {}, []);

  return {
    tuples,
    subjects,
    namespaces,
    loading: false,
    error: null,
    permissionResults,
    loadingPermissions: false,
    checkUserPermissions,
  };
}

export function getOfflineExampleKeys() {
  return Object.keys(OFFLINE_EXAMPLES);
}
