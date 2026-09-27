import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)

test('React와 React DOM은 동일한 런타임 버전으로 설치된다', () => {
  const react = require('react/package.json') as { version: string }
  const reactDom = require('react-dom/package.json') as { version: string }
  assert.equal(react.version, reactDom.version,
    'React와 React DOM 버전을 함께 갱신하고 lockfile을 다시 생성해 주세요.')
})
