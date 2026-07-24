import { useMemo, useCallback } from "react";

import OFFLINE_EXAMPLES from "../data/offlineExamples";
import { deriveSubjects } from "../api/ketoClient";
import type { PermissionResult } from "../api/ketoClient";
import type { KetoData } from "./useKetoData";

// Stable empty result so memos depending on permissionResults keep their identity.
const NO_PERMISSION_RESULTS: PermissionResult[] = [];

/**
 * Hook that provides tuple data from bundled offline examples.
 * Mirrors the useKetoData interface so App.tsx can swap between them.
 */
export function useOfflineData(exampleKey: string | null): KetoData {
  const tuples = useMemo(() => {
    if (!exampleKey || !OFFLINE_EXAMPLES[exampleKey]) return [];
    return OFFLINE_EXAMPLES[exampleKey];
  }, [exampleKey]);

  const subjects = useMemo(() => deriveSubjects(tuples), [tuples]);

  // Namespaces of both objects and subject sets, so subject namespaces (User)
  // show up in the legend and the editor dropdowns.
  const namespaces = useMemo(() => {
    const ns = new Set<string>();
    for (const t of tuples) {
      ns.add(t.namespace);
      if (t.subject_set) ns.add(t.subject_set.namespace);
    }
    return Array.from(ns).sort();
  }, [tuples]);

  const checkSubjectPermissions = useCallback(() => {}, []);

  return {
    tuples,
    subjects,
    namespaces,
    loading: false,
    error: null,
    permissionResults: NO_PERMISSION_RESULTS,
    loadingPermissions: false,
    checkSubjectPermissions,
  };
}

export function getOfflineExampleKeys(): string[] {
  return Object.keys(OFFLINE_EXAMPLES);
}
