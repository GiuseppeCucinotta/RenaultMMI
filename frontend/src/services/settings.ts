import { checkServiceHealth } from "@/services/health";
import { SETTINGS_DEFAULT_BASE_URL } from "@/constants/settings";
import type {
  CategoryDef,
  SettingsCategoryId,
  SettingsCategoryValuesBody,
  SettingsCategoriesBody,
  SettingsState,
  SettingsValues,
  SettingsValuesBody,
} from "@/types/settings";

export async function getSettingsEndpoint(): Promise<string> {
  try {
    const endpoint = await window.settings?.getEndpoint();
    if (endpoint?.baseUrl) return endpoint.baseUrl;
  } catch {
    // preload bridge unavailable — fall through to the default
  }
  return SETTINGS_DEFAULT_BASE_URL;
}

export const checkSettingsHealth = checkServiceHealth;

export async function fetchSettingsCategories(baseUrl: string): Promise<CategoryDef[]> {
  const response = await fetch(`${baseUrl}/api/categories`);
  if (!response.ok) throw new Error(`Settings categories unavailable (${response.status})`);
  const body = (await response.json()) as SettingsCategoriesBody;
  return Array.isArray(body?.categories) ? body.categories : [];
}

export async function fetchSettingsValues(
  baseUrl: string,
): Promise<Record<SettingsCategoryId, SettingsValues>> {
  const response = await fetch(`${baseUrl}/api/values`);
  if (!response.ok) throw new Error(`Settings values unavailable (${response.status})`);
  const body = (await response.json()) as SettingsValuesBody;
  return body?.values ?? {};
}

/**
 * The `/api/state` payload already carries the whole schema plus values, so the
 * initial load is a single request.
 */
export async function fetchSettingsState(baseUrl: string): Promise<SettingsState> {
  const response = await fetch(`${baseUrl}/api/state`);
  if (!response.ok) throw new Error(`Settings state unavailable (${response.status})`);
  return (await response.json()) as SettingsState;
}

export async function patchSettingsValues(
  baseUrl: string,
  categoryId: SettingsCategoryId,
  values: SettingsValues,
): Promise<SettingsValues> {
  const response = await fetch(`${baseUrl}/api/values/${encodeURIComponent(categoryId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ values }),
  });
  if (!response.ok) throw new Error(`Settings update rejected (${response.status})`);
  const body = (await response.json()) as SettingsCategoryValuesBody;
  return body.values;
}

export async function resetSettingsCategory(
  baseUrl: string,
  categoryId: SettingsCategoryId,
): Promise<SettingsValues> {
  const response = await fetch(
    `${baseUrl}/api/values/${encodeURIComponent(categoryId)}/reset`,
    { method: "POST" },
  );
  if (!response.ok) throw new Error(`Settings reset rejected (${response.status})`);
  const body = (await response.json()) as SettingsCategoryValuesBody;
  return body.values;
}

export function subscribeSettings(
  baseUrl: string,
  onState: (state: SettingsState) => void,
): () => void {
  const source = new EventSource(`${baseUrl}/api/events`);
  source.onmessage = (event) => {
    try {
      const state = JSON.parse(event.data) as SettingsState;
      onState(state);
    } catch {
      // ignore malformed frames
    }
  };
  return () => source.close();
}
