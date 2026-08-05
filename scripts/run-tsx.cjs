'use strict'

const path = require('node:path')
const { pathToFileURL } = require('node:url')

const preload = path.resolve(__dirname, 'node-windows-userinfo.cjs')
const preloadOption = `--require=${preload}`
process.env.NODE_OPTIONS = [process.env.NODE_OPTIONS, preloadOption].filter(Boolean).join(' ')
require(preload)

const tsxCli = path.resolve(__dirname, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs')
process.argv = [process.argv[0], tsxCli, ...process.argv.slice(2)]

void import(pathToFileURL(tsxCli).href)
