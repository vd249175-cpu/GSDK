import { parseGenerationPrompt } from './generation-prompt.mjs'

function parameterValue(name, value, definition) {
  const valid = definition.type === 'integer'
    ? Number.isInteger(value)
    : definition.type === 'number'
      ? typeof value === 'number' && Number.isFinite(value)
      : typeof value === definition.type
  if (!valid) throw new Error(`参数 ${name} 必须是 ${definition.type}`)
  if (definition.enum && !definition.enum.includes(value)) throw new Error(`参数 ${name} 不在允许范围内`)
  if (definition.minimum !== undefined && value < definition.minimum) throw new Error(`参数 ${name} 不能小于 ${definition.minimum}`)
  if (definition.maximum !== undefined && value > definition.maximum) throw new Error(`参数 ${name} 不能大于 ${definition.maximum}`)
  return value
}

function matchingVariant(model, values) {
  return model.variants.find((variant) => {
    const when = variant?.when
    return when && typeof when.parameter === 'string' && values[when.parameter] === when.equals
  }) ?? null
}

function resolvedParameters(model, config, requestedModelId) {
  const unknown = Object.keys(config).filter((name) => name !== 'model' && !Object.hasOwn(model.parameters, name))
  if (unknown.length) throw new Error(`模型 ${model.id} 不支持参数: ${unknown.join(', ')}`)
  const source = { ...model.defaults, ...(model.aliasDefaults?.[requestedModelId] ?? {}), ...config }
  delete source.model
  const variant = matchingVariant(model, source)
  const values = { ...source, ...(variant?.defaults ?? {}) }
  const effective = {}
  for (const [name, value] of Object.entries(values)) {
    const definition = model.parameters[name]
    if (!definition) throw new Error(`模型 ${model.id} 不支持参数: ${name}`)
    effective[definition.outputName ?? name] = parameterValue(name, value, definition)
  }
  return { source: values, effective, variant }
}

function referenceReplacement(reference, ordinal, promptPolicy) {
  const type = reference.type ?? 'image'
  const template = promptPolicy.aliases?.[type]
  if (typeof template === 'string') {
    return template
      .replaceAll('{ordinal}', String(ordinal))
      .replaceAll('{id}', String(reference.id ?? ''))
      .replaceAll('{title}', String(reference.title ?? ''))
      .replaceAll('{content}', String(reference.content ?? reference.title ?? reference.id ?? ''))
  }
  if (type === 'image') return `Image_${ordinal}`
  if (type === 'video') return `Video_${ordinal}`
  if (type === 'audio') return `Audio_${ordinal}`
  return String(reference.content ?? reference.title ?? reference.id ?? '')
}

function compilePrompt(body, references, policy, sourceParameters) {
  let prompt = body
  const aliases = {}
  const ordinal = {}
  for (const reference of references) {
    const type = reference.type ?? 'image'
    ordinal[type] = (ordinal[type] ?? 0) + 1
    const replacement = (policy.stripTypes ?? []).includes(type)
      ? ''
      : referenceReplacement(reference, ordinal[type], policy)
    const prefix = { image: '@', video: '%', audio: '~', style: '&', text: '$' }[type] ?? ''
    const candidates = [`[${prefix}${reference.title}]`, `${prefix}${reference.title}`, reference.id].filter(Boolean)
    for (const candidate of candidates) prompt = prompt.split(candidate).join(replacement)
    aliases[reference.id] = replacement
    if (reference.title) aliases[`[${prefix}${reference.title}]`] = replacement
  }
  if (Array.isArray(policy.stripTypes) && policy.stripTypes.length) {
    const prefixes = policy.stripTypes.map((type) => ({ image: '@', video: '%', audio: '~', style: '&', text: '$' }[type])).filter(Boolean).join('')
    if (prefixes) prompt = prompt.replace(new RegExp(`\\[[${prefixes}][^\\]]+\\]`, 'g'), '')
  }
  if (policy.stripAllReferences === true) prompt = prompt.replace(/\[[~@&$%][^\]]+\]/g, '')
  const emotion = policy.emotion
  if (emotion?.parameter && emotion.tags && !prompt.includes('<|emotion:') && !prompt.includes('<|style:')) {
    const tag = emotion.tags[String(sourceParameters[emotion.parameter] ?? '')]
    if (tag) prompt = `${tag}${prompt}`
  }
  return { prompt: prompt.trim(), aliases }
}

function dependencyRules(model, variant) {
  return { ...model.dependencies, ...(variant?.dependencies ?? {}) }
}

function assertDependencies(model, variant, references, sourceParameters) {
  const rules = dependencyRules(model, variant)
  const counts = Object.fromEntries(['image', 'video', 'audio', 'text', 'style'].map((type) => [
    type, references.filter((reference) => reference.type === type).length,
  ]))
  for (const [type, constraint] of Object.entries(rules.counts ?? {})) {
    const count = counts[type] ?? 0
    if (constraint.minimum !== undefined && count < constraint.minimum) throw new Error(constraint.message ?? `模型 ${model.id} 至少需要 ${constraint.minimum} 个 ${type} 引用`)
    if (constraint.maximum !== undefined && count > constraint.maximum) throw new Error(constraint.message ?? `模型 ${model.id} 最多支持 ${constraint.maximum} 个 ${type} 引用`)
    if (constraint.exact !== undefined && count !== constraint.exact) throw new Error(constraint.message ?? `模型 ${model.id} 必须提供 ${constraint.exact} 个 ${type} 引用`)
  }
  for (const [parameter, constraint] of Object.entries(rules.parameterMaximums ?? {})) {
    if (Number(sourceParameters[parameter]) > Number(constraint.maximum)) {
      throw new Error(constraint.message ?? `参数 ${parameter} 不能大于 ${constraint.maximum}`)
    }
  }
  for (const requirement of rules.atLeastOneReferenceOf ?? []) {
    const total = requirement.types.reduce((sum, type) => sum + (counts[type] ?? 0), 0)
    if (total === 0) {
      throw new Error(requirement.message ?? `模型 ${model.id} 至少需要一个 ${requirement.types.join('/')} 引用`)
    }
  }
  for (const requirement of rules.requiredReferenceOrParameter ?? []) {
    if ((counts[requirement.type] ?? 0) === 0 && !String(sourceParameters[requirement.parameter] ?? '').trim()) {
      throw new Error(`模型 ${model.id} 需要 ${requirement.type} 引用或参数 ${requirement.parameter}`)
    }
  }
  for (const requirement of rules.parameterRequiredWhenReferenced ?? []) {
    if ((counts[requirement.type] ?? 0) > 0 && !String(sourceParameters[requirement.parameter] ?? '').trim()) {
      throw new Error(`模型 ${model.id} 使用 ${requirement.type} 引用时必须提供参数 ${requirement.parameter}`)
    }
  }
  for (const reference of references) {
    if (rules.referenceDurationAtMostParameter && reference.type === 'audio') {
      const duration = reference.duration ?? reference.metadata?.duration
      const maximum = sourceParameters[rules.referenceDurationAtMostParameter]
      if (duration && maximum && duration > maximum) throw new Error(`音频参考【${reference.title || reference.id}】的时长 (${duration}s) 超出了目标视频时长 (${maximum}s)`)
    }
    if (['image', 'video', 'audio'].includes(reference.type ?? 'image') && rules.requireReady !== false && (!reference.isReady || !reference.filePath)) {
      throw new Error(`预检失败: 依赖【${reference.title || reference.id}】尚未就绪或缺少本地媒体文件`)
    }
    if (['text', 'style'].includes(reference.type) && !String(reference.content ?? '').trim()) {
      throw new Error(`预检失败: 依赖【${reference.title || reference.id}】的文本内容为空`)
    }
  }
}

function budgetResult(rule, sourceParameters, options = {}) {
  const selected = rule ?? { kind: 'free' }
  if (selected.kind === 'free') return { estimatedCredits: 0, mode: selected.mode ?? 'free', formula: selected.formula ?? '0', currency: selected.currency ?? 'credits' }
  if (selected.kind === 'fixed') return { estimatedCredits: Number(selected.credits), mode: selected.mode ?? 'fixed', formula: selected.formula ?? `${selected.credits}`, currency: selected.currency ?? 'credits' }
  const parameter = selected.parameter ?? 'duration'
  const units = Number(options[parameter] ?? sourceParameters[parameter] ?? selected.baseUnits ?? 0)
  if (options.customRate !== undefined && options.customRate !== null) {
    const rate = Number(options.customRate)
    const credits = Math.round(units * rate * 100) / 100
    return { estimatedCredits: credits, mode: 'custom_rate', formula: `${units}s × ${rate} 积分/秒 = ${credits} Credits`, currency: selected.currency ?? 'credits' }
  }
  if (selected.kind === 'linear') {
    const rate = Number(options.customRate ?? selected.rate)
    const credits = Math.round(units * rate * 100) / 100
    return { estimatedCredits: credits, mode: options.customRate !== undefined ? 'custom_rate' : (selected.mode ?? 'linear'), formula: `${units} × ${rate}`, currency: selected.currency ?? 'credits' }
  }
  if (selected.kind === 'stepped') {
    const baseUnits = Number(selected.baseUnits ?? 0)
    const multiplierKey = String(sourceParameters[selected.multiplierParameter] ?? '').toLowerCase()
    const multiplier = Number(selected.multipliers?.[multiplierKey] ?? selected.defaultMultiplier ?? 1)
    const credits = Math.round((Number(selected.base) + Math.max(0, units - baseUnits) * Number(selected.perUnit)) * multiplier * 100) / 100
    return { estimatedCredits: credits, mode: selected.mode ?? 'stepped', formula: `[${selected.base} + max(0, ${units}-${baseUnits}) × ${selected.perUnit}] × ${multiplier} = ${credits.toFixed(1)} Credits`, currency: selected.currency ?? 'credits' }
  }
  throw new Error(`预算规则不受支持: ${selected.kind}`)
}

export function estimateModelBudgetV2(snapshot, options = {}) {
  const requestedModelId = String(options.model ?? snapshot.model.id)
  const config = {
    ...(options.params ?? {}),
    ...(options.duration !== undefined ? { duration: options.duration } : {}),
    ...(options.resolution !== undefined ? { resolution: options.resolution } : {}),
  }
  const parameters = resolvedParameters(snapshot.model, config, requestedModelId)
  return budgetResult(parameters.variant?.budget ?? snapshot.model.budget, parameters.source, options)
}

export function compileModelIntentV2(snapshot, input) {
  if (!input?.prompt) throw new Error('缺少生成提示词 prompt')
  const model = snapshot.model
  const parsed = parseGenerationPrompt(input.prompt)
  if (!parsed.modelId) throw new Error('提示词 YAML 头部必须声明 model: <model-id>')
  if (parsed.modelId !== model.id && !(model.aliases ?? []).includes(parsed.modelId)) throw new Error(`模型快照 ${model.id} 与提示词模型 ${parsed.modelId} 不一致`)
  if (input.nodeType && model.mediaType !== input.nodeType) throw new Error(`模型 ${model.id} 只能用于 ${model.mediaType} 节点`)
  const parameters = resolvedParameters(model, parsed.config, parsed.modelId)
  const references = Array.isArray(input.references) ? input.references : []
  const compiled = compilePrompt(parsed.body, references, model.prompt ?? {}, parameters.source)
  if (!compiled.prompt) throw new Error('预检失败: 生成提示词正文不能为空')
  const budgetRule = parameters.variant?.budget ?? model.budget
  return {
    model: structuredClone(model),
    body: parsed.body,
    prompt: compiled.prompt,
    aliases: compiled.aliases,
    effectiveConfig: parameters.effective,
    sourceConfig: parameters.source,
    estimatedCredits: budgetResult(budgetRule, parameters.source, input.budgetOptions).estimatedCredits,
    budget: budgetResult(budgetRule, parameters.source, input.budgetOptions),
    variant: parameters.variant ? structuredClone(parameters.variant) : null,
  }
}

export function buildModelRequestV2(snapshot, input) {
  const resolved = compileModelIntentV2(snapshot, input)
  const references = Array.isArray(input.references) ? input.references : []
  assertDependencies(snapshot.model, resolved.variant, references, resolved.sourceConfig)
  return {
    kind: snapshot.execution.kind === 'audio-task' ? 'audio-payload' : 'comfy-workflow',
    workflowType: snapshot.model.id,
    inputs: { prompt: resolved.prompt, ...resolved.effectiveConfig },
    references: references.map((reference) => ({ ...reference })),
    model: structuredClone(snapshot),
  }
}
