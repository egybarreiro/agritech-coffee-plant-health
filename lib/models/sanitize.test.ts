// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { clampConfidence, sanitizePrediction, sanitizeTextList } from './sanitize'
import type { PlantModelPrediction } from './types'

function validPrediction(): PlantModelPrediction {
  return {
    conditionKey: 'foliar-disease-suspected',
    generalHealthAssessment: 'La hoja muestra lesiones.',
    confidence: 0.72,
    estimatedSeverity: 'medium',
    detectedSymptoms: ['Manchas marrones.'],
    recommendedPreventiveActions: ['Mejora la ventilación.'],
    recommendedCorrectiveActions: ['Aísla la planta.'],
    followUpInstructions: 'Repite en 7 días.',
    expertInspectionRecommended: false,
  }
}

describe('clampConfidence', () => {
  it('keeps values inside [0, 1]', () => {
    expect(clampConfidence(0.5)).toBe(0.5)
    expect(clampConfidence(0)).toBe(0)
    expect(clampConfidence(1)).toBe(1)
    expect(clampConfidence(-3)).toBe(0)
    expect(clampConfidence(7)).toBe(1)
    expect(clampConfidence(0.12345)).toBe(0.123)
  })

  it('collapses non-numeric input to a conservative middle score', () => {
    expect(clampConfidence(Number.NaN)).toBe(0.5)
    expect(clampConfidence(undefined as unknown as number)).toBe(0.5)
  })
})

describe('sanitizeTextList', () => {
  it('trims, drops empties, caps count and length', () => {
    const long = 'x'.repeat(500)
    const result = sanitizeTextList(['  Manchas.  ', '', 42 as unknown as string, long, ...Array.from({ length: 20 }, (_, i) => `${i}`)])
    expect(result).toHaveLength(12)
    expect(result[0]).toBe('Manchas.')
    expect(result.every((item) => item.length <= 240)).toBe(true)
  })

  it('returns an empty array for non-arrays', () => {
    expect(sanitizeTextList(null)).toEqual([])
    expect(sanitizeTextList('texto' as unknown as unknown[])).toEqual([])
  })
})

describe('sanitizePrediction', () => {
  it('passes a valid prediction through unchanged', () => {
    const prediction = validPrediction()
    expect(sanitizePrediction(prediction)).toEqual(prediction)
  })

  it('repairs invalid severity, confidence, and missing fields', () => {
    const sanitized = sanitizePrediction({
      ...validPrediction(),
      conditionKey: '   ',
      confidence: 12,
      estimatedSeverity: 'catastrophic' as PlantModelPrediction['estimatedSeverity'],
      detectedSymptoms: 'noeslista' as unknown as string[],
      potentialExplanations: ['   ', 'Posible roya.'],
    })
    expect(sanitized.conditionKey).toBe('unknown')
    expect(sanitized.confidence).toBe(1)
    expect(sanitized.estimatedSeverity).toBe('unknown')
    expect(sanitized.detectedSymptoms).toEqual([])
    expect(sanitized.potentialExplanations).toEqual(['Posible roya.'])
  })

  it('normalizes followUpInstructions to null when blank', () => {
    const sanitized = sanitizePrediction({ ...validPrediction(), followUpInstructions: '    ' } as PlantModelPrediction)
    expect(sanitized.followUpInstructions).toBeNull()
  })
})
