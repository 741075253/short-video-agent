'use strict'

if (process.platform === 'win32' && typeof process.geteuid !== 'function') {
  process.geteuid = () => process.env.USERNAME || process.env.USER || 'windows'
}
