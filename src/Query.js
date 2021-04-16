import { $managerSize } from './DataManager.js'
import { $componentMap } from './Component.js'
import { $entityMasks, $entityEnabled, getEntityCursor } from './Entity.js'
import { diff } from './Serialize.js'

export function Not(c) { return function QueryNot() { return c } }
export function Changed(c) { return function QueryChanged() { return c } }

export const $queries = Symbol('queries')
export const $queryMap = Symbol('queryMap')
export const $queryComponents = Symbol('queryComponents')
export const $enterQuery = Symbol('enterQuery')
export const $exitQuery = Symbol('exitQuery')

export const enterQuery = (world, query, fn) => {
  if (!world[$queryMap].get(query)) registerQuery(world, query)
  world[$queryMap].get(query).enter = fn
}

export const exitQuery = (world, query, fn) => {
  if (!world[$queryMap].get(query)) registerQuery(world, query)
  world[$queryMap].get(query).exit = fn
}

export const registerQuery = (world, query) => {
  if (!world[$queryMap].get(query)) world[$queryMap].set(query, {})

  let components = []
  let notComponents = []
  let changedComponents = []
  query[$queryComponents].forEach(c => {
    if (typeof c === 'function') {
      if (c.name === 'QueryNot') {
        notComponents.push(c())
      }
      if (c.name === 'QueryChanged') {
        changedComponents.push(c())
        components.push(c())
      }
    } else {
      components.push(c)
    }
  })

  const mapComponents = c => world[$componentMap].get(c)

  const size = components.reduce((a,c) => c[$managerSize] > a ? c[$managerSize] : a, 0)
  
  const entities = []
  const changed = []
  const indices = new Uint32Array(size)
  const enabled = new Uint8Array(size)
  const generations = components
    .concat(notComponents)
    .map(mapComponents)
    .map(c => c.generationId)
    .reduce((a,v) => {
      if (a.includes(v)) return a
      a.push(v)
      return a
    }, [])
    
  const reduceBitmasks = (a,c) => {
    if (!a[c.generationId]) a[c.generationId] = 0
    a[c.generationId] |= c.bitflag
    return a
  }
  const masks = components
    .map(mapComponents)
    .reduce(reduceBitmasks, {})

  const notMasks = components
    .map(mapComponents)
    .reduce((a,c) => {
      if (!a[c.generationId] && notComponents.includes(c)) a[c.generationId] = 0
      a[c.generationId] |= c.bitflag
      return a
    }, {})

  const flatProps = components
    .map(c => c._flatten ? c._flatten() : [c])
    .reduce((a,v) => a.concat(v), [])

  Object.assign(
    world[$queryMap].get(query), { 
      entities,
      changed,
      enabled,
      components,
      notComponents,
      changedComponents,
      masks,
      notMasks,
      generations,
      indices,
      flatProps
    }
  )
  world[$queries].add(query)

  for (let eid = 0; eid < getEntityCursor(); eid++) {
    if (!world[$entityEnabled][eid]) continue
    if (queryCheckEntity(world, query, eid)) {
      queryAddEntity(world, query, eid)
    }
  }
}

export const defineQuery = (components) => {
  const query = function (world) {
    if (!world[$queryMap].has(query)) registerQuery(world, query)
    const q = world[$queryMap].get(query) 
    if (q.changedComponents.length) return diff(world, query)
    return q.entities
  }
  query[$queryComponents] = components
  return query
}

// TODO: archetype graph
export const queryCheckEntity = (world, query, eid) => {
  const { masks, notMasks, generations } = world[$queryMap].get(query)
  for (let i = 0; i < generations.length; i++) {
    const generationId = generations[i]
    const qMask = masks[generationId]
    const qNotMask = notMasks[generationId]
    const eMask = world[$entityMasks][generationId][eid]
    // if (qNotMask && !(eMask & qNotMask)) {
    //   return false
    // }
    if ((eMask & qMask) !== qMask) {
      return false
    }
  }
  return true
}

const queryCheckComponent = (world, query, component) => {
  const { generationId, bitflag } = world[$componentMap].get(component)
  const { masks } = world[$queryMap].get(query)
  const mask = masks[generationId]
  return (mask & bitflag) === bitflag
}

export const queryCheckComponents = (world, query, components) => {
  return components.every(c => queryCheckComponent(world, query, c))
}

export const queryAddEntity = (world, query, eid) => {
  const q = world[$queryMap].get(query)
  if (q.enabled[eid]) return
  q.enabled[eid] = true
  q.entities.push(eid)
  q.indices[eid] = q.entities.length - 1
  if (q.enter) q.enter(eid)
}

export const queryRemoveEntity = (world, query, eid) => {
  const q = world[$queryMap].get(query)
  if (!q.enabled[eid]) return
  q.enabled[eid] = false
  q.entities.splice(q.indices[eid])
  if (q.exit) q.exit(eid)
}
