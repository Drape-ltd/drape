#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_ROOT = path.resolve(__dirname, '..', 'app')
const ROUTE_ROOTS = [path.join(APP_ROOT, '(customer)'), path.join(APP_ROOT, '(tailor)')]
const MESSAGE =
  'Do not use raw router navigation. Use resetTo(), goBackOrReturnTo(), or appendToHistory() from @drape/mobile/lib/navigation instead.'
const CONTEXTUAL_BACK_MESSAGE =
  'Contextual routes must register useContextualBackHandler() so Android Back follows the same returnTo/historyChain contract as the visible Back or X control.'
const STACK_GESTURE_MESSAGE =
  'Nested route stacks must set gestureEnabled: false so iOS swipe cannot bypass the contextual exit contract.'
const DYNAMIC_PARAM_NAMES = new Set([
  'clientId',
  'diaryId',
  'id',
  'itemId',
  'orderId',
  'tailorId',
])

function walk(dir) {
  if (!fs.existsSync(dir)) return []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walk(absolute))
      continue
    }
    if (/\.[jt]sx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      files.push(absolute)
    }
  }
  return files
}

function propertyName(name) {
  if (!name) return null
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
  return null
}

function unwrapExpression(node) {
  let current = node
  while (
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression
  }
  return current
}

function objectProperty(objectLiteral, key) {
  return objectLiteral.properties.find((property) => {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) return false
    return propertyName(property.name) === key
  })
}

function propertyInitializer(property) {
  if (!property) return null
  if (ts.isPropertyAssignment(property)) return unwrapExpression(property.initializer)
  return null
}

function hasProperty(objectLiteral, key) {
  return !!objectProperty(objectLiteral, key)
}

function hasAnyProperty(objectLiteral, keys) {
  return objectLiteral.properties.some((property) => keys.has(propertyName(property.name)))
}

function isRouterCall(node, methodName) {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === methodName &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'router'
  )
}

function isDynamicPathExpression(expression) {
  if (!expression) return false
  if (ts.isTemplateExpression(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return true
  if (ts.isStringLiteral(expression)) return expression.text.includes('[')
  return true
}

function routeObjectNeedsHistory(routeObject) {
  const pathname = propertyInitializer(objectProperty(routeObject, 'pathname'))
  const params = propertyInitializer(objectProperty(routeObject, 'params'))
  if (isDynamicPathExpression(pathname)) return true
  if (!params || !ts.isObjectLiteralExpression(params)) return false
  if (hasProperty(params, 'returnTo')) return true
  return hasAnyProperty(params, DYNAMIC_PARAM_NAMES)
}

function routeObjectHasHistory(routeObject) {
  const params = propertyInitializer(objectProperty(routeObject, 'params'))
  return !!params && ts.isObjectLiteralExpression(params) && hasProperty(params, 'historyChain')
}

function formatDiagnostic(sourceFile, node) {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  const relative = path.relative(path.resolve(__dirname, '..'), sourceFile.fileName)
  return `${relative}:${position.line + 1}:${position.character + 1} ${MESSAGE}`
}

function formatFileDiagnostic(file, message) {
  const relative = path.relative(path.resolve(__dirname, '..'), file)
  return `${relative}:1:1 ${message}`
}

function isNestedRouteLayout(file) {
  if (path.basename(file) !== '_layout.tsx') return false
  const relativeSegments = path.relative(APP_ROOT, file).split(path.sep)
  return relativeSegments.length > 2
}

const diagnostics = []

for (const file of ROUTE_ROOTS.flatMap(walk)) {
  const sourceText = fs.readFileSync(file, 'utf8')
  const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

  if (
    /\bgoBackOrReturnTo(?:IfNeeded)?\s*\(/u.test(sourceText) &&
    !/\buseContextualBackHandler\s*\(/u.test(sourceText)
  ) {
    diagnostics.push(formatFileDiagnostic(file, CONTEXTUAL_BACK_MESSAGE))
  }

  if (isNestedRouteLayout(file) && !/gestureEnabled\s*:\s*false/u.test(sourceText)) {
    diagnostics.push(formatFileDiagnostic(file, STACK_GESTURE_MESSAGE))
  }

  function visit(node) {
    if (isRouterCall(node, 'back')) {
      diagnostics.push(formatDiagnostic(sourceFile, node))
    }

    if (isRouterCall(node, 'push') || isRouterCall(node, 'replace') || isRouterCall(node, 'navigate')) {
      const firstArg = node.arguments[0] ? unwrapExpression(node.arguments[0]) : null
      if (firstArg && (ts.isTemplateExpression(firstArg) || ts.isNoSubstitutionTemplateLiteral(firstArg))) {
        diagnostics.push(formatDiagnostic(sourceFile, node))
      } else if (
        firstArg &&
        ts.isObjectLiteralExpression(firstArg) &&
        routeObjectNeedsHistory(firstArg) &&
        !routeObjectHasHistory(firstArg)
      ) {
        diagnostics.push(formatDiagnostic(sourceFile, node))
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
}

if (diagnostics.length > 0) {
  console.error(diagnostics.join('\n'))
  process.exit(1)
}
