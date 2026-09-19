import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SETTINGS_HEALTH_POLL_MS } from "@/constants/settings";
import { MOCK_SETTINGS_STATE } from "@/data/settings.mock";
import {
  checkSettingsHealth,
  fetchSettingsState,
  getSettingsEndpoint,
  patchSettingsValues,
  resetSettingsCategory,
  subscribeSettings,
} from "@/services/settings";
import type {
  CategoryDef,
  FieldValue,
  SettingsCategoryId,
  SettingsMode,
  SettingsState,
} from "@/types/settings";

export interface UseSettingsResult {
  mode: SettingsMode;
  isService: boolean;
  categories: CategoryDef[];
  values: SettingsState["values"];
  activeCategoryId: SettingsCategoryId | null;
  selectCategory: (categoryId: SettingsCategoryId) => void;
  /** Optimistic write; rolls back to the pre-write value if the service rejects it. */
  setValue: (categoryId: SettingsCategoryId, fieldId: string, value: FieldValue) => Promise<void>;
  resetCategory: (categoryId: SettingsCategoryId) => Promise<void>;
}

/**
 * Settings state for the renderer.
 *
 * Deliberately mirrors `useCd`: probe `/api/health` once, poll every 5 s, switch
 * to the static mock when the service is unreachable so a plain browser stays
 * usable, and never throw into render.
 */
export function useSettings(): UseSettingsResult {
  const [mode, setMode] = useState<SettingsMode>("loading");
  const [state, setState] = useState<SettingsState>(MOCK_SETTINGS_STATE);
  const [activeCategoryId, setActiveCategoryId] = useState<SettingsCategoryId | null>(null);
  const endpointRef = useRef<string | null>(null);
  const modeRef = useRef<SettingsMode>("loading");

  const setModeSafe = useCallback((next: SettingsMode) => {
    modeRef.current = next;
    setMode(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: number | undefined;

    const check = async (baseUrl: string) => {
      const healthy = await checkSettingsHealth(baseUrl);
      if (cancelled) return;
      const current = modeRef.current;

      if (healthy && current !== "service") {
        try {
          const loaded = await fetchSettingsState(baseUrl);
          if (cancelled) return;
          setState(loaded);
          setModeSafe("service");
        } catch {
          if (cancelled) return;
          setModeSafe("mock");
        }
      } else if (!healthy && current === "service") {
        setState(MOCK_SETTINGS_STATE);
        setModeSafe("mock");
      }
    };

    (async () => {
      let baseUrl: string;
      try {
        baseUrl = await getSettingsEndpoint();
      } catch {
        if (!cancelled) setModeSafe("mock");
        return;
      }
      endpointRef.current = baseUrl;
      await check(baseUrl);
      if (cancelled) return;
      pollTimer = window.setInterval(() => void check(baseUrl), SETTINGS_HEALTH_POLL_MS);
    })();

    return () => {
      cancelled = true;
      if (pollTimer) window.clearInterval(pollTimer);
    };
  }, [setModeSafe]);

  useEffect(() => {
    if (mode !== "service" || !endpointRef.current) return;
    return subscribeSettings(endpointRef.current, setState);
  }, [mode]);

  // Keep a valid selection as the schema arrives (or changes under us).
  useEffect(() => {
    if (state.categories.length === 0) {
      if (activeCategoryId !== null) setActiveCategoryId(null);
      return;
    }
    const stillValid = state.categories.some((category) => category.id === activeCategoryId);
    if (!stillValid) setActiveCategoryId(state.categories[0].id);
  }, [state.categories, activeCategoryId]);

  const isService = mode === "service";

  /**
   * Applies a write optimistically for responsiveness, then adopts the service's
   * answer. The service is authoritative because it is what normalises values
   * (slider snapping, range clamping), so its response replaces the guess; on
   * failure the service's state is re-fetched rather than reconstructed, which
   * keeps concurrent writes from rolling each other back.
   */
  const setValue = useCallback(
    async (categoryId: SettingsCategoryId, fieldId: string, value: FieldValue) => {
      const baseUrl = endpointRef.current;
      if (!isService || !baseUrl) return;

      setState((prev) => ({
        ...prev,
        values: {
          ...prev.values,
          [categoryId]: { ...prev.values[categoryId], [fieldId]: value },
        },
      }));

      try {
        const values = await patchSettingsValues(baseUrl, categoryId, { [fieldId]: value });
        setState((prev) => ({
          ...prev,
          values: { ...prev.values, [categoryId]: values },
        }));
      } catch {
        try {
          const fresh = await fetchSettingsState(baseUrl);
          setState(fresh);
        } catch {
          // The service is unreachable; the health poll will switch to mock mode.
        }
      }
    },
    [isService],
  );

  const resetCategory = useCallback(
    async (categoryId: SettingsCategoryId) => {
      const baseUrl = endpointRef.current;
      if (!isService || !baseUrl) return;
      try {
        const values = await resetSettingsCategory(baseUrl, categoryId);
        setState((prev) => ({
          ...prev,
          values: { ...prev.values, [categoryId]: values },
        }));
      } catch {
        // SSE or the next poll will correct the state; nothing to roll back.
      }
    },
    [isService],
  );

  const selectCategory = useCallback((categoryId: SettingsCategoryId) => {
    setActiveCategoryId(categoryId);
  }, []);

  return useMemo(
    () => ({
      mode,
      isService,
      categories: state.categories,
      values: state.values,
      activeCategoryId,
      selectCategory,
      setValue,
      resetCategory,
    }),
    [mode, isService, state, activeCategoryId, selectCategory, setValue, resetCategory],
  );
}
