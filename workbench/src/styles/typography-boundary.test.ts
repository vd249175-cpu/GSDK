import { describe, expect, it } from 'vitest'

const styleSources = import.meta.glob('./*.css', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>
const featureStyles = Object.entries(styleSources)
  .filter(([name]) => !name.endsWith('/typography.css'))
  .map(([name, source]) => ({ name, source }))

function declarations(source: string, property: string) {
  const pattern = new RegExp(`${property}\\s*:\\s*([^;]+);`, 'g')
  return [...source.matchAll(pattern)].map((match) => match[1].trim())
}

describe('Typography token boundary', () => {
  it('keeps feature font families, sizes, weights and line heights on shared tokens', () => {
    const invalid = featureStyles.flatMap(({ name, source }) => [
      ...declarations(source, 'font-family')
        .filter((value) => value !== 'inherit' && !value.startsWith('var('))
        .map((value) => `${name}: font-family: ${value}`),
      ...declarations(source, 'font-size')
        .filter((value) => value !== '0' && !value.startsWith('var('))
        .map((value) => `${name}: font-size: ${value}`),
      ...declarations(source, 'font-weight')
        .filter((value) => !value.startsWith('var('))
        .map((value) => `${name}: font-weight: ${value}`),
      ...declarations(source, 'line-height')
        .filter((value) => !value.startsWith('var('))
        .map((value) => `${name}: line-height: ${value}`),
      ...declarations(source, 'font')
        .filter((value) => value !== 'inherit' && !value.startsWith('var('))
        .map((value) => `${name}: font: ${value}`),
    ])
    expect(invalid).toEqual([])
  })
})
