/**
 * Model registry — where the REAL coffee model is connected.
 *
 * Selection is environment-gated: when `COFFEE_MODEL_ENDPOINT` holds a valid
 * http(s) URL, the real EfficientNetB0 adapter (`coffee-real.ts`, which calls
 * the Python FastAPI inference service) is active for coffee; otherwise the
 * clearly-labeled mock adapter stays registered as the documented fallback so
 * demos, tests and local development keep working exactly as before.
 *
 * Rule enforced app-wide: mock adapters declare `isMock: true` and an `id`
 * starting with 'mock-'; `isMockProvider` is the single helper the API and UI
 * use to label simulated results. Nothing may present a mock prediction as a
 * real model output. The real adapter reports `isMock: false` and a
 * non-'mock-' id, so all simulation banners disappear automatically when it
 * is active.
 */
import { mockCoffeeAdapter } from './mock-coffee'
import { coffeeRealAdapter, isCoffeeModelServiceConfigured } from './coffee-real'
import type { CropName, PlantModelAdapter } from './types'

/** Fallback table — clearly-labeled simulation adapters only. */
const mockAdaptersByCrop: Record<CropName, PlantModelAdapter | null> = {
  coffee: mockCoffeeAdapter,
}

/** Real-model table — selected only when the inference endpoint is configured. */
const realAdaptersByCrop: Record<CropName, PlantModelAdapter | null> = {
  coffee: coffeeRealAdapter,
}

function activeAdapters(): Record<CropName, PlantModelAdapter | null> {
  return isCoffeeModelServiceConfigured() ? realAdaptersByCrop : mockAdaptersByCrop
}

/** Resolves the active adapter for a `crops.name` value; null when the crop has no enabled model. */
export function getAdapterForCrop(cropName: string | null | undefined): PlantModelAdapter | null {
  if (cropName !== 'coffee') return null
  return activeAdapters()[cropName] ?? null
}

/** True only for placeholder implementations producing simulated results. */
export function isMockProvider(modelProvider: string | null | undefined): boolean {
  return typeof modelProvider === 'string' && modelProvider.startsWith('mock')
}

/** Registry listing for docs, admin screens, and tests (mirrors the active table). */
export function listRegisteredModels(): Array<
  Pick<PlantModelAdapter, 'id' | 'version' | 'crop' | 'isMock' | 'description'>
> {
  return Object.values(activeAdapters())
    .filter((adapter): adapter is PlantModelAdapter => adapter !== null)
    .map(({ id, version, crop, isMock, description }) => ({ id, version, crop, isMock, description }))
}
